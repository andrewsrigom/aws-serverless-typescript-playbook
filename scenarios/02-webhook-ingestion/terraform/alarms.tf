variable "enable_alarms" {
  type        = bool
  default     = false
  description = "Opt in to billable CloudWatch alarms for this sandbox."
}

variable "alarm_action_arns" {
  type        = list(string)
  default     = []
  description = "Existing SNS topic ARNs; empty means console-only alarms."
  validation {
    condition     = alltrue([for arn in var.alarm_action_arns : can(regex("^arn:aws:sns:[a-z0-9-]+:[0-9]{12}:[A-Za-z0-9_-]+$", arn))])
    error_message = "Use existing SNS topic ARNs."
  }
}
