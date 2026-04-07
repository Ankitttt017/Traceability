| 7.1 | Valid Login | **PASS** | 200 OK, token returned |
| 7.1 | Invalid Login | **PASS** | 401 Unauthorized |
| 7.2 | Unauthorized dashboard access | **FAIL** | Status: 404 |
| 7.2 | Unauthorized traceability access | **FAIL** | Status: 404 |
| 7.3 | Dashboard Data Endpoint | **FAIL** | Unexpected token '<', "<!DOCTYPE "... is not valid JSON |
| 7.4 | Traceability Invalid Part | **PASS** | Status: 404 (expected) |
| 7.5 | Reports Export PDF | **FAIL** | Status: 404 (Endpoint might not exist at this exact path) |
| 7.6 | Device CRUD Create Valid | **FAIL** | Status: 404 (Route mismatch: Actual app might use /api/machines) |
| 7.6 | Device CRUD Create Empty | **FAIL** | Status: 404 Not Found (Endpoint incorrect) |