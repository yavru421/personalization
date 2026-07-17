import urllib.request
import json
import base64
import time

BASE_URL = "https://personalization.dondlingergc.com"

def request_json(url, data=None, headers=None, method="POST"):
    req_headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    if headers:
        req_headers.update(headers)
    
    req_data = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=req_data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read().decode("utf-8")), res.info()
    except urllib.error.HTTPError as e:
        try:
            err_data = json.loads(e.read().decode("utf-8"))
        except:
            err_data = e.reason
        return e.code, err_data, e.headers

def run_tests():
    test_email = f"test_{int(time.time())}@dondlingergc.com"
    test_password = "SecurePassword123!"
    
    print(f"[TEST 1] Registering test user: {test_email}...")
    status, res, headers = request_json(f"{BASE_URL}/api/auth/register", {"email": test_email, "password": test_password})
    print(f"Status: {status}, Response: {res}")
    print(f"Set-Cookie header: {headers.get('Set-Cookie')}")
    assert status == 200, "Registration failed"
    assert "userId" in res, "No userId returned"
    assert headers.get('Set-Cookie') is not None and "dgc-session" in headers.get('Set-Cookie'), "Registration Set-Cookie missing"
    
    print("\n[TEST 2] Logging in...")
    status, res, headers = request_json(f"{BASE_URL}/api/auth/login", {"email": test_email, "password": test_password})
    print(f"Status: {status}, Response: {res}")
    print(f"Set-Cookie header: {headers.get('Set-Cookie')}")
    assert status == 200, "Login failed"
    token = res["token"]
    refresh_token = res["refresh_token"]
    user_id = res["user"]["id"]
    assert headers.get('Set-Cookie') is not None and "dgc-session" in headers.get('Set-Cookie'), "Login Set-Cookie missing"
    
    print("\n[TEST 3] Verifying JWT claims payload structure...")
    parts = token.split(".")
    payload_b64 = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
    claims = json.loads(base64.b64decode(payload_b64).decode("utf-8"))
    print(f"Decoded claims: {claims}")
    assert claims["sub"] == user_id, "Subject claim mismatch"
    assert claims["email"] == test_email, "Email claim mismatch"
    assert claims["subscription_tier"] == "free", "Default tier mismatch"
    
    print("\n[TEST 4] Posting settings (using Bearer token)...")
    token_headers = {"Authorization": f"Bearer {token}"}
    settings_payload = {"settings": {"theme": "dracula", "unit": "imperial", "locations": ["Chicago, IL", "London, UK"]}}
    status, res, _ = request_json(f"{BASE_URL}/api/settings", settings_payload, headers=token_headers, method="POST")
    print(f"Status: {status}, Response: {res}")
    assert status == 200, "Saving settings failed"
    
    print("\n[TEST 5] Getting settings (using cookie auth)...")
    cookie = headers.get("Set-Cookie").split(";")[0]
    cookie_headers = {"Cookie": cookie}
    status, res, _ = request_json(f"{BASE_URL}/api/settings", headers=cookie_headers, method="GET")
    print(f"Status: {status}, Response: {res}")
    assert status == 200, "Retrieving settings failed"
    assert res["settings"]["theme"] == "dracula", "Settings theme mismatch"
    assert "Chicago, IL" in res["settings"]["locations"], "Settings location missing"
    
    print("\n[TEST 6] Refreshing token...")
    status, res, headers = request_json(f"{BASE_URL}/api/auth/refresh", {"refresh_token": refresh_token})
    print(f"Status: {status}, Response: {res}")
    print(f"Set-Cookie header: {headers.get('Set-Cookie')}")
    assert status == 200, "Token refresh failed"
    new_token = res["token"]
    assert headers.get('Set-Cookie') is not None and "dgc-session" in headers.get('Set-Cookie'), "Refresh Set-Cookie missing"
    
    print("\n[TEST 7] Fetching settings with rotated token...")
    token_headers = {"Authorization": f"Bearer {new_token}"}
    status, res, _ = request_json(f"{BASE_URL}/api/settings", headers=token_headers, method="GET")
    print(f"Status: {status}, Response: {res}")
    assert status == 200, "Retrieving settings with new token failed"
    
    print("\n[TEST 8] Logging out (verifying cookie clearing)...")
    status, res, headers = request_json(f"{BASE_URL}/api/auth/logout", {"refresh_token": refresh_token})
    print(f"Status: {status}, Response: {res}")
    print(f"Set-Cookie header: {headers.get('Set-Cookie')}")
    assert status == 200, "Logout failed"
    assert headers.get('Set-Cookie') is not None and "Max-Age=0" in headers.get('Set-Cookie'), "Logout Cookie clear missing"
    
    print("\n=== ALL API INTEGRATION TESTS PASSED DETERMINISTICALLY! ===")

if __name__ == "__main__":
    run_tests()
