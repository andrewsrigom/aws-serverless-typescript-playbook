terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.64.0" }
  }
}

variable "region" { default = "us-east-1" }

variable "environment" {
  default = "dev"
  validation {
    condition     = can(regex("^[a-z0-9-]{1,12}$", var.environment))
    error_message = "Use 1-12 lowercase letters, digits or hyphens."
  }
}

variable "target_account_id" {
  type        = string
  description = "Explicitly approved sandbox account ID. The provider refuses other accounts."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.target_account_id))
    error_message = "Provide the approved 12-digit AWS account ID."
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.target_account_id]
  default_tags {
    tags = { Project = "aws-serverless-typescript-playbook", Environment = var.environment, Scenario = "12-secure-upload", ManagedBy = "Terraform" }
  }
}


locals { name = "aws-playbook-upload-${var.environment}" }

variable "enable_workers" {
  type    = bool
  default = false
}

resource "aws_s3_bucket" "uploads" {
  bucket        = "${local.name}-${var.target_account_id}-${var.region}"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    id     = "expire-sandbox-uploads"
    status = "Enabled"
    filter { prefix = "incoming/" }
    expiration { days = 1 }
    noncurrent_version_expiration { noncurrent_days = 1 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
  rule {
    id     = "remove-expired-markers"
    status = "Enabled"
    filter { prefix = "incoming/" }
    expiration { expired_object_delete_marker = true }
  }
  depends_on = [aws_s3_bucket_versioning.uploads]
}

resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid       = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*",
    Resource  = [aws_s3_bucket.uploads.arn, "${aws_s3_bucket.uploads.arn}/*"],
    Condition = { Bool = { "aws:SecureTransport" = "false", "aws:PrincipalIsAWSService" = "false" } }
  }] })
}

module "uploads" {
  source            = "../../../terraform/modules/queue"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = local.name
  publishers        = [{ service = "s3.amazonaws.com", source_arn = aws_s3_bucket.uploads.arn, source_account = var.target_account_id }]
}

resource "aws_s3_bucket_notification" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  queue {
    queue_arn     = module.uploads.arn
    events        = ["s3:ObjectCreated:Post"]
    filter_prefix = "incoming/"
    filter_suffix = ".json"
  }
  depends_on = [module.uploads, aws_s3_bucket_versioning.uploads]
}

resource "aws_dynamodb_table" "results" {
  name         = local.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
  on_demand_throughput {
    max_read_request_units  = 10
    max_write_request_units = 10
  }
}

module "issuer" {
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-issuer"
  artifact          = "${path.module}/../../../dist/12-secure-upload/issue-handler.zip"
  environment       = { BUCKET_NAME = aws_s3_bucket.uploads.id }
  statements        = [{ actions = ["s3:PutObject"], resources = ["${aws_s3_bucket.uploads.arn}/incoming/*"] }]
}

module "processor" {
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-processor"
  artifact          = "${path.module}/../../../dist/12-secure-upload/process-handler.zip"
  environment       = { BUCKET_NAME = aws_s3_bucket.uploads.id, TABLE_NAME = aws_dynamodb_table.results.name }
  statements = [
    { actions = ["s3:GetObjectVersion"], resources = ["${aws_s3_bucket.uploads.arn}/incoming/*"] },
    { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [module.uploads.arn] },
    { actions = ["dynamodb:PutItem"], resources = [aws_dynamodb_table.results.arn] }
  ]
}

resource "aws_lambda_event_source_mapping" "uploads" {
  event_source_arn        = module.uploads.arn
  function_name           = module.processor.arn
  enabled                 = var.enable_workers
  batch_size              = 5
  function_response_types = ["ReportBatchItemFailures"]
  scaling_config { maximum_concurrency = 2 }
}

output "issuer_function" { value = module.issuer.name }
output "bucket_name" { value = aws_s3_bucket.uploads.id }
output "queue_url" { value = module.uploads.url }
output "dlq_url" { value = module.uploads.dlq_url }
output "table_name" { value = aws_dynamodb_table.results.name }
