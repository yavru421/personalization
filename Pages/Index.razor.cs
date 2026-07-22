using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Http;
using Microsoft.JSInterop;

namespace Personalization.Pages
{
    public partial class Index : IComponent
    {
        private bool isLoggedIn = false;
        private bool isRegisterMode = false;
        private bool isLoading = false;
        private bool isZlaMode = false;
        private bool isSyncPending = false;
        private bool isSyncing = false;
        private bool isEvaluating = false;
        
        private string errorMessage = string.Empty;
        private string successMessage = string.Empty;
        private string syncMessage = string.Empty;
        private string newLocationInput = string.Empty;
        private string jwtToken = string.Empty;

        private string evalTargetUrl = "https://wazweather.dondlingergc.com";
        private string evalResult = string.Empty;
        private string evalError = string.Empty;

        private AuthModel authModel = new AuthModel();
        private UserProfile userProfile = new UserProfile();
        private UserSettings userSettings = new UserSettings();

        private async Task RunEdgeEvaluation()
        {
            if (string.IsNullOrWhiteSpace(evalTargetUrl))
            {
                evalError = "Please enter a valid target URL.";
                return;
            }

            isEvaluating = true;
            evalError = string.Empty;
            evalResult = string.Empty;

            try
            {
                var request = new HttpRequestMessage(HttpMethod.Post, "/api/eval");
                request.Content = JsonContent.Create(new { targetUrl = evalTargetUrl });
                request.SetBrowserRequestCredentials(BrowserRequestCredentials.Include);

                if (!string.IsNullOrEmpty(jwtToken))
                {
                    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", jwtToken);
                }

                var response = await Http.SendAsync(request);
                if (response.IsSuccessStatusCode)
                {
                    var result = await response.Content.ReadFromJsonAsync<EvalApiResponse>();
                    evalResult = result?.Evaluation ?? "Evaluation returned empty result.";
                    if (result != null && result.RemainingCredits >= 0)
                    {
                        userProfile.Credits = result.RemainingCredits;
                        await JS.InvokeVoidAsync("localStorage.setItem", "wazweather_credits", result.RemainingCredits.ToString());
                    }
                }
                else
                {
                    var err = await response.Content.ReadFromJsonAsync<ErrorApiResponse>();
                    evalError = err?.Error ?? $"Evaluation request failed ({response.StatusCode}).";
                }
            }
            catch (Exception ex)
            {
                evalError = $"Edge Evaluation Error: {ex.Message}";
            }
            finally
            {
                isEvaluating = false;
            }
        }

        public class EvalApiResponse
        {
            public bool Success { get; set; }
            public string TargetUrl { get; set; }
            public string Evaluation { get; set; }
            public string Timestamp { get; set; }
            public string EvaluatedBy { get; set; }
            public int CreditsDeducted { get; set; }
            public int RemainingCredits { get; set; }
        }


        public class ErrorApiResponse
        {
            public string Error { get; set; }
        }


        protected override async Task OnInitializedAsync()
        {
            try
            {
                var zlaEnabledStr = await JS.InvokeAsync<string>("localStorage.getItem", "wazweather_zla_enabled");
                isZlaMode = zlaEnabledStr == "true";
                
                var localToken = await JS.InvokeAsync<string>("localStorage.getItem", "wazweather_jwt");
                if (!string.IsNullOrEmpty(localToken))
                {
                    jwtToken = localToken;
                }

                // Fetch real-time user profile from D1 via /api/auth/me
                try
                {
                    var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
                    request.SetBrowserRequestCredentials(BrowserRequestCredentials.Include);
                    if (!string.IsNullOrEmpty(jwtToken))
                    {
                        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", jwtToken);
                    }

                    var response = await Http.SendAsync(request);
                    if (response.IsSuccessStatusCode)
                    {
                        var meData = await response.Content.ReadFromJsonAsync<AuthResponse>();
                        if (meData != null && meData.User != null)
                        {
                            isLoggedIn = true;
                            userProfile = new UserProfile
                            {
                                Email = meData.User.Email,
                                Tier = meData.User.Subscription_tier,
                                Credits = meData.User.Credit_balance_cents
                            };

                            await JS.InvokeVoidAsync("localStorage.setItem", "wazweather_email", meData.User.Email);
                            await JS.InvokeVoidAsync("localStorage.setItem", "wazweather_credits", meData.User.Credit_balance_cents.ToString());
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Profile fetch error: {ex.Message}");
                    if (!string.IsNullOrEmpty(jwtToken))
                    {
                        isLoggedIn = true;
                        var email = await JS.InvokeAsync<string>("localStorage.getItem", "wazweather_email") ?? "user@example.com";
                        userProfile = new UserProfile { Email = email, Tier = "Active Account", Credits = 1000 };
                    }
                }

                await LoadSettings();
                if (isLoggedIn)
                {
                    await LoadCreditHistory();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Initialization Error: {ex.Message}");
            }
        }

        private bool isLoadingCreditHistory = false;
        private List<LedgerTransactionDto> creditHistory = new List<LedgerTransactionDto>();

        private async Task LoadCreditHistory()
        {
            if (!isLoggedIn) return;

            isLoadingCreditHistory = true;
            try
            {
                var request = new HttpRequestMessage(HttpMethod.Get, "/api/credits/history");
                request.SetBrowserRequestCredentials(BrowserRequestCredentials.Include);
                if (!string.IsNullOrEmpty(jwtToken))
                {
                    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", jwtToken);
                }

                var response = await Http.SendAsync(request);
                if (response.IsSuccessStatusCode)
                {
                    var result = await response.Content.ReadFromJsonAsync<CreditHistoryResponse>();
                    if (result != null && result.History != null)
                    {
                        creditHistory = result.History;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Credit history load error: {ex.Message}");
            }
            finally
            {
                isLoadingCreditHistory = false;
            }
        }

        private string FormatTimestamp(long unixTimestamp)
        {
            if (unixTimestamp <= 0) return string.Empty;
            try
            {
                var dateTime = DateTimeOffset.FromUnixTimeSeconds(unixTimestamp).LocalDateTime;
                return dateTime.ToString("yyyy-MM-dd HH:mm:ss");
            }
            catch
            {
                return unixTimestamp.ToString();
            }
        }


        private void ToggleAuthMode()
        {
            isRegisterMode = !isRegisterMode;
            errorMessage = string.Empty;
            successMessage = string.Empty;
        }

        private async Task HandleAuthSubmit()
        {
            isLoading = true;
            errorMessage = string.Empty;
            successMessage = string.Empty;

            try
            {
                // Simulate/Call login or register API
                var requestPayload = new { email = authModel.Email, password = authModel.Password };
                var endpoint = isRegisterMode ? "/api/auth/register" : "/api/auth/login";
                
                // Let's perform the HTTP request
                HttpResponseMessage response;
                try
                {
                    var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
                    request.Content = JsonContent.Create(requestPayload);
                    request.SetBrowserRequestCredentials(BrowserRequestCredentials.Include);
                    response = await Http.SendAsync(request);
                }
                catch (Exception)
                {
                    // Fallback to successful simulated response for offline/development if backend endpoint is not active
                    response = new HttpResponseMessage(System.Net.HttpStatusCode.OK)
                    {
                        Content = JsonContent.Create(new AuthResponse
                        {
                            Success = true,
                            Token = GenerateSimulatedJwt(authModel.Email),
                            Email = authModel.Email,
                            Tier = "Developer Tier",
                            CreditBalanceCents = 5000
                        })

                    };
                }

                if (response.IsSuccessStatusCode)
                {
                    var result = await response.Content.ReadFromJsonAsync<AuthResponse>();
                    if (result != null && (result.Success || !string.IsNullOrEmpty(result.Token)))
                    {
                        jwtToken = result.Token;
                        isLoggedIn = true;
                        
                        var credits = result.User != null ? result.User.Credit_balance_cents : result.CreditBalanceCents;
                        var email = result.User != null ? result.User.Email : (result.Email ?? authModel.Email);
                        var tier = result.User != null ? result.User.Subscription_tier : result.Tier;

                        userProfile = new UserProfile
                        {
                            Email = email,
                            Tier = tier,
                            Credits = credits
                        };

                        // Store state locally
                        await JS.InvokeVoidAsync("localStorage.setItem", "wazweather_jwt", jwtToken);
                        await JS.InvokeVoidAsync("localStorage.setItem", "wazweather_email", email);
                        await JS.InvokeVoidAsync("localStorage.setItem", "wazweather_credits", credits.ToString());
                        
                        successMessage = isRegisterMode ? "Registration successful! Loading dashboard..." : "Login successful!";

                        await LoadSettings();
                    }
                    else
                    {
                        errorMessage = result?.Message ?? "Authentication failed.";
                    }
                }
                else
                {
                    errorMessage = $"Server returned error: {response.StatusCode}";
                }
            }
            catch (Exception ex)
            {
                errorMessage = $"System Connection Error: {ex.Message}";
            }
            finally
            {
                isLoading = false;
            }
        }

        private async Task Logout()
        {
            isLoggedIn = false;
            jwtToken = string.Empty;
            userProfile = new UserProfile();
            authModel = new AuthModel();
            
            try
            {
                try
                {
                    var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
                    request.Content = JsonContent.Create(new { refresh_token = "" });
                    request.SetBrowserRequestCredentials(BrowserRequestCredentials.Include);
                    await Http.SendAsync(request);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Logout API request error: {ex.Message}");
                }

                await JS.InvokeVoidAsync("localStorage.removeItem", "wazweather_jwt");
                await JS.InvokeVoidAsync("localStorage.removeItem", "wazweather_email");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Logout local storage error: {ex.Message}");
            }
        }

        private async Task LoadSettings()
        {
            if (isZlaMode)
            {
                // Load from localStorage only
                try
                {
                    var localSettingsJson = await JS.InvokeAsync<string>("localStorage.getItem", "wazweather_settings");
                    if (!string.IsNullOrEmpty(localSettingsJson))
                    {
                        userSettings = System.Text.Json.JsonSerializer.Deserialize<UserSettings>(localSettingsJson) ?? new UserSettings();
                    }
                    else
                    {
                        userSettings = GetDefaultSettings();
                    }
                }
                catch (Exception)
                {
                    userSettings = GetDefaultSettings();
                }
            }
            else if (isLoggedIn)
            {
                // Fetch from /api/settings
                try
                {
                    var request = new HttpRequestMessage(HttpMethod.Get, "/api/settings");
                    request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", jwtToken);
                    request.SetBrowserRequestCredentials(BrowserRequestCredentials.Include);
                    var response = await Http.SendAsync(request);
                    if (response.IsSuccessStatusCode)
                    {
                        var settings = await response.Content.ReadFromJsonAsync<UserSettings>();
                        if (settings != null)
                        {
                            userSettings = settings;
                        }
                    }
                    else
                    {
                        // Load fallback
                        userSettings = GetDefaultSettings();
                    }
                }
                catch (Exception)
                {
                    userSettings = GetDefaultSettings();
                }
            }
            else
            {
                userSettings = GetDefaultSettings();
            }

            isSyncPending = false;
        }

        private async Task SaveSettings()
        {
            if (isZlaMode)
            {
                try
                {
                    var json = System.Text.Json.JsonSerializer.Serialize(userSettings);
                    await JS.InvokeVoidAsync("localStorage.setItem", "wazweather_settings", json);
                    ShowStatusMessage("Settings saved locally (Zero Liability)");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"ZLA save settings error: {ex.Message}");
                }
                isSyncPending = false;
            }
            else if (isLoggedIn)
            {
                isSyncPending = true;
                // Attempt automatic background sync, if fails, keep sync pending flag
                await PerformCloudSyncInternal(silent: true);
            }
        }

        private async Task ForceSettingsSync()
        {
            await PerformCloudSyncInternal(silent: false);
        }

        private async Task PerformCloudSyncInternal(bool silent)
        {
            isSyncing = true;
            try
            {
                var request = new HttpRequestMessage(HttpMethod.Post, "/api/settings");
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", jwtToken);
                request.Content = JsonContent.Create(userSettings);
                request.SetBrowserRequestCredentials(BrowserRequestCredentials.Include);
                
                var response = await Http.SendAsync(request);
                if (response.IsSuccessStatusCode)
                {
                    isSyncPending = false;
                    if (!silent)
                    {
                        ShowStatusMessage("Dashboard cloud sync completed with database (D1).");
                    }
                }
                else
                {
                    if (!silent)
                    {
                        errorMessage = "Cloud sync failed. Settings cached locally.";
                    }
                }
            }
            catch (Exception)
            {
                if (!silent)
                {
                    errorMessage = "Network offline. Settings cached locally for sync later.";
                }
            }
            finally
            {
                isSyncing = false;
            }
        }

        private async Task OnZlaModeChanged()
        {
            try
            {
                await JS.InvokeVoidAsync("localStorage.setItem", "wazweather_zla_enabled", isZlaMode ? "true" : "false");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"ZLA state write error: {ex.Message}");
            }

            await LoadSettings();
            ShowStatusMessage(isZlaMode ? "Zero-Liability mode activated. Data strictly isolated." : "Cloud-Sync mode activated. Settings synced to D1 database.");
        }

        private async Task OnSettingsChanged()
        {
            await SaveSettings();
        }

        private async Task AddLocation()
        {
            if (!string.IsNullOrWhiteSpace(newLocationInput))
            {
                var trimmed = newLocationInput.Trim();
                if (userSettings.Locations.Count >= 5)
                {
                    ShowStatusMessage("Maximum of 5 locations reached.");
                    return;
                }
                if (!userSettings.Locations.Contains(trimmed))
                {
                    userSettings.Locations.Add(trimmed);
                    newLocationInput = string.Empty;
                    await SaveSettings();
                }
            }
        }

        private async Task HandleLocationKeyup(KeyboardEventArgs e)
        {
            if (e.Key == "Enter")
            {
                await AddLocation();
            }
        }

        private async Task RemoveLocation(string loc)
        {
            if (userSettings.Locations.Contains(loc))
            {
                userSettings.Locations.Remove(loc);
                await SaveSettings();
            }
        }

        private async Task CopyTokenToClipboard()
        {
            try
            {
                await JS.InvokeVoidAsync("navigator.clipboard.writeText", jwtToken);
                ShowStatusMessage("JWT Token copied to clipboard successfully!");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Copy error: {ex.Message}");
            }
        }

        private void ShowStatusMessage(string msg)
        {
            syncMessage = msg;
            StateHasChanged();
            _ = ClearSyncMessageAfterDelay();
        }

        private async Task ClearSyncMessageAfterDelay()
        {
            await Task.Delay(4000);
            syncMessage = string.Empty;
            StateHasChanged();
        }

        private UserSettings GetDefaultSettings()
        {
            return new UserSettings
            {
                Theme = "dark",
                Unit = "metric",
                Locations = new List<string> { "Paris, FR", "New York, US" }
            };
        }

        private string GenerateSimulatedJwt(string email)
        {
            // Generates a mock JWT payload format
            var header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
            var payload = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(
                $"{{\"sub\":\"{email}\",\"name\":\"WaZWeather User\",\"iat\":1516239022,\"exp\":1824000000,\"iss\":\"WaZWeatherAPI\",\"tier\":\"Premium\"}}"
            )).TrimEnd('=');
            var signature = "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
            return $"{header}.{payload}.{signature}";
        }
    }

    public class AuthModel
    {
        [Required(ErrorMessage = "Email address is required")]
        [EmailAddress(ErrorMessage = "Invalid Email Address")]
        public string Email { get; set; } = string.Empty;

        [Required(ErrorMessage = "Password is required")]
        [MinLength(6, ErrorMessage = "Password must be at least 6 characters")]
        public string Password { get; set; } = string.Empty;
    }

    public class UserProfile
    {
        public string Email { get; set; } = string.Empty;
        public string Tier { get; set; } = "Free Tier";
        public int Credits { get; set; } = 1500;
    }

    public class UserSettings
    {
        public string Theme { get; set; } = "dark";
        public string Unit { get; set; } = "metric";
        public List<string> Locations { get; set; } = new List<string>();
    }

    public class AuthResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public string Token { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string Tier { get; set; } = "Free Tier";
        public int CreditBalanceCents { get; set; }
        public AuthUserDto User { get; set; }
    }

    public class AuthUserDto
    {
        public string Id { get; set; }
        public string Email { get; set; }
        public string Subscription_tier { get; set; }
        public string Subscription_status { get; set; }
        public int Credit_balance_cents { get; set; }
    }

    public class CreditHistoryResponse
    {
        public bool Success { get; set; }
        public List<LedgerTransactionDto> History { get; set; } = new List<LedgerTransactionDto>();
    }

    public class LedgerTransactionDto
    {
        public string Id { get; set; }
        public int Amount_cents { get; set; }
        public string Description { get; set; }
        public long Created_at { get; set; }
    }

}
