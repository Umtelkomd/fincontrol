#!/usr/bin/env python3
"""Check Firestore using the correct appId path."""
import json, subprocess, urllib.request, ssl, sys

result = subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True)
token = result.stdout.strip()
if not token:
    print("No gcloud token - trying Firebase Admin directly")
    sys.exit(1)

proj = 'umtelkomd-finance'
APP_ID = '1:597712756560:web:ad12cd9794f11992641655'

# REST API
coll = f'artifacts/{APP_ID}/public/data/bankMovements'
url = f'https://firestore.googleapis.com/v1/projects/{proj}/databases/(default)/documents:runQuery'

ctx = ssl.create_default_context()
body = json.dumps({
    'structuredQuery': {
        'from': [{'collectionId': coll}],
        'limit': 3,
        'orderBy': [{'field': {'fieldPath': 'postedDate'}, 'direction': 'DESCENDING'}]
    }
}).encode()

req = urllib.request.Request(url, data=body,
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
try:
    resp = urllib.request.urlopen(req, context=ctx, timeout=10)
    data = json.loads(resp.read())
    docs = data.get('documents', [])
    print(f'bankMovements: Got {len(docs)} docs')
    for doc in docs:
        name = doc.get('name', '').split('/')[-1]
        fields = doc.get('fields', {})
        cat = fields.get('categoryName', fields.get('category', {}))
        print(f'  id={name[:12]} cat={cat} dir={fields.get("direction",{}).get("stringValue","?")} amt={fields.get("amount",{}).get("doubleValue","?")} postedDate={fields.get("postedDate",{}).get("stringValue","?")[:7]}')
except Exception as e:
    print(f'bankMovements error: {e}')

# Try transactions
coll2 = f'artifacts/{APP_ID}/public/data/transactions'
body2 = json.dumps({
    'structuredQuery': {
        'from': [{'collectionId': coll2}],
        'limit': 5,
        'orderBy': [{'field': {'fieldPath': 'date'}, 'direction': 'DESCENDING'}]
    }
}).encode()
req2 = urllib.request.Request(url, data=body2,
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
try:
    resp2 = urllib.request.urlopen(req2, context=ctx, timeout=10)
    data2 = json.loads(resp2.read())
    docs2 = data2.get('documents', [])
    print(f'\ntransactions: Got {len(docs2)} docs')
    for doc in docs2:
        name = doc.get('name', '').split('/')[-1]
        fields = doc.get('fields', {})
        cat = fields.get('category', fields.get('categoryName', {}))
        print(f'  id={name[:12]} cat={cat} type={fields.get("type",{}).get("stringValue","?")} amt={fields.get("amount",{}).get("doubleValue","?")} date={fields.get("date",{}).get("stringValue","?")[:10]}')
except Exception as e:
    print(f'transactions error: {e}')
