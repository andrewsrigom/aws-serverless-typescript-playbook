#!/usr/bin/env python3
"""Opt-in deployed smoke tests. Never creates infrastructure."""
import argparse
import datetime
import hashlib
import hmac
import json
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('scenario', choices=[f'{n:02}' for n in range(1, 10)])
p.add_argument('--outputs', required=True, type=Path)
p.add_argument('--region', required=True)
p.add_argument('--allow-remote', action='store_true')
p.add_argument('--secret-arn')
a = p.parse_args()
if not a.allow_remote:
    p.error('Deployed smoke tests write sample data; explicitly add --allow-remote')
outputs = json.loads(a.outputs.read_text())

def out(key):
    return outputs[key]['value']

def aws(*args):
    return json.loads(subprocess.check_output(['aws', *args, '--region', a.region, '--output', 'json'], text=True))

def invoke(name, payload):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / 'response.json'
        meta = aws('lambda', 'invoke', '--function-name', name, '--cli-binary-format', 'raw-in-base64-out', '--payload', json.dumps(payload), str(path))
        if meta.get('FunctionError'):
            raise RuntimeError('Lambda smoke invocation failed; inspect redacted CloudWatch logs')
        return json.loads(path.read_text())

def item(table, key, expected_field=None, expected_value=None):
    for _ in range(30):
        value = aws('dynamodb', 'get-item', '--table-name', table, '--key', json.dumps({'id': {'S': key}}), '--consistent-read').get('Item')
        if value and (expected_field is None or value.get(expected_field) == expected_value):
            return value
        time.sleep(1)
    raise RuntimeError('Expected DynamoDB record was not observed within 30 seconds')

def send(queue, payload):
    return aws('sqs', 'send-message', '--queue-url', queue, '--message-body', json.dumps(payload))
identity = 'smoke-' + uuid.uuid4().hex
if a.scenario == '01':
    endpoint = out('endpoint')
    credentials = json.loads(subprocess.check_output(['aws', 'configure', 'export-credentials', '--format', 'process'], text=True))

    def signed(method, path, body):
        url = endpoint + path
        host = urllib.parse.urlparse(url).netloc
        now = datetime.datetime.now(datetime.timezone.utc)
        stamp = now.strftime('%Y%m%dT%H%M%SZ')
        day = stamp[:8]
        headers = {'host': host, 'x-amz-date': stamp, 'content-type': 'application/json'}
        if credentials.get('SessionToken'):
            headers['x-amz-security-token'] = credentials['SessionToken']
        names = ';'.join(sorted(headers))
        canonical = ''.join((k + ':' + headers[k] + '\n' for k in sorted(headers)))
        digest = hashlib.sha256(body).hexdigest()
        request = '\n'.join([method, path, '', canonical, names, digest])
        scope = f'{day}/{a.region}/execute-api/aws4_request'
        string = '\n'.join(['AWS4-HMAC-SHA256', stamp, scope, hashlib.sha256(request.encode()).hexdigest()])
        key = ('AWS4' + credentials['SecretAccessKey']).encode()
        for part in [day, a.region, 'execute-api', 'aws4_request']:
            key = hmac.new(key, part.encode(), hashlib.sha256).digest()
        signature = hmac.new(key, string.encode(), hashlib.sha256).hexdigest()
        headers['Authorization'] = f'AWS4-HMAC-SHA256 Credential={credentials['AccessKeyId']}/{scope}, SignedHeaders={names}, Signature={signature}'
        with urllib.request.urlopen(urllib.request.Request(url, data=body if method == 'POST' else None, headers=headers, method=method), timeout=10) as response:
            return (response.status, json.load(response))
    payload = {'id': identity, 'title': 'Smoke resource'}
    status, result = signed('POST', '/resources', json.dumps(payload).encode())
    assert status == 201 and result == payload
    status, result = signed('GET', '/resources/' + identity, b'')
    assert status == 200 and result == payload
elif a.scenario == '02':
    if not out('public_webhook_enabled'):
        p.error('This HMAC-only smoke requires an explicitly enabled public webhook test session')
    if not a.secret_arn:
        p.error('--secret-arn is required for the signed webhook smoke test')
    secret = aws('secretsmanager', 'get-secret-value', '--secret-id', a.secret_arn)['SecretString']
    body = json.dumps({'id': identity, 'type': 'resource.changed', 'resourceId': identity, 'revision': 1}).encode()
    stamp = str(int(time.time()))
    signature = hmac.new(secret.encode(), stamp.encode() + b'.' + body, hashlib.sha256).hexdigest()
    request = urllib.request.Request(out('webhook_endpoint') + '/webhook', data=body, headers={'Content-Type': 'application/json', 'x-playbook-timestamp': stamp, 'x-playbook-signature': 'v1=' + signature})
    with urllib.request.urlopen(request, timeout=20) as response:
        assert response.status == 202
    item(out('table_name'), identity, 'status', {'S': 'COMPLETED'})
elif a.scenario in ['03', '04']:
    payload = {'id': identity, 'quantity': 2} if a.scenario == '03' else {'id': identity, 'text': 'normalize'}
    send(out('queue_url'), payload)
    send(out('queue_url'), payload)
    item(out('table_name'), identity, 'status', {'S': 'RECORDED' if a.scenario == '03' else 'COMPLETED'})
elif a.scenario == '05':
    invoke(out('publisher_function_name'), {'id': identity, 'version': 1, 'kind': 'created', 'resourceId': identity, 'revision': 1})
    item(out('audit_table_name'), identity)
    item(out('index_table_name'), identity)
elif a.scenario == '06':
    for kind in ['created', 'deleted']:
        key = identity + '-' + kind
        invoke(out('publisher_function_name'), {'source': 'playbook.resources', 'detail-type': f'resource.{kind}.v1', 'detail': {'id': key, 'schemaVersion': 1, 'resourceId': identity, 'revision': 1}})
        item(out(kind + '_table_name'), key)
elif a.scenario == '07':
    aws('dynamodb', 'put-item', '--table-name', out('table_name'), '--item', json.dumps({'id': {'S': identity}, 'status': {'S': 'PENDING'}}))
    invoke(out('function_name'), {})
    item(out('table_name'), identity, 'status', {'S': 'RECONCILED'})
elif a.scenario == '08':
    invoke(out('ingestion_function_name'), {'id': identity, 'schemaVersion': 1, 'entityId': identity, 'revision': 2})
    item(out('table_name'), identity, 'revision', {'N': '2'})
    invoke(out('ingestion_function_name'), {'id': identity + '-old', 'schemaVersion': 1, 'entityId': identity, 'revision': 1})
elif a.scenario == '09':
    # These queues belong only to this scenario; replay remains a dry run.
    send(out('source_queue_url'), {'id': identity, 'revision': 1})
    subprocess.run(['pnpm', 'replay', '--source', out('source_queue_url'), '--destination', out('destination_queue_url'), '--limit', '1'], check=True)
print('PASS deployed smoke scenario ' + a.scenario + '; sample identity ' + identity)
