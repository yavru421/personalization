using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.WebAssembly.Http;
using Microsoft.JSInterop;

namespace Personalization.Pages
{
    public partial class Scraper : ComponentBase
    {
        [Inject] public HttpClient Http { get; set; }
        [Inject] public IJSRuntime JS { get; set; }

        private string targetUrl = "https://wazweather.dondlingergc.com";
        private string inferenceMode = "architectural";
        private string viewTab = "formatted";
        private bool isExecuting = false;

        private string scrapeResult = string.Empty;
        private string rawJsonResponse = string.Empty;
        private string errorMessage = string.Empty;
        private string statusNotification = string.Empty;

        private List<ScrapeHistoryItem> recentScrapes = new List<ScrapeHistoryItem>();

        protected override async Task OnInitializedAsync()
        {
            await LoadScrapeHistory();
        }

        private async Task ExecuteScraper()
        {
            if (string.IsNullOrWhiteSpace(targetUrl))
            {
                errorMessage = "Please enter a valid URL target.";
                return;
            }

            if (!targetUrl.StartsWith("http://") && !targetUrl.StartsWith("https://"))
            {
                targetUrl = "https://" + targetUrl;
            }

            isExecuting = true;
            errorMessage = string.Empty;
            scrapeResult = string.Empty;
            rawJsonResponse = string.Empty;

            try
            {
                var request = new HttpRequestMessage(HttpMethod.Post, "/api/eval");
                request.Content = JsonContent.Create(new 
                { 
                    targetUrl = targetUrl,
                    mode = inferenceMode
                });
                request.SetBrowserRequestCredentials(BrowserRequestCredentials.Include);

                var response = await Http.SendAsync(request);
                var rawText = await response.Content.ReadAsStringAsync();
                rawJsonResponse = rawText;

                if (response.IsSuccessStatusCode)
                {
                    var result = System.Text.Json.JsonSerializer.Deserialize<ScrapeApiResponse>(rawText, new System.Text.Json.JsonSerializerOptions 
                    { 
                        PropertyNameCaseInsensitive = true 
                    });

                    scrapeResult = result?.Evaluation ?? "Scrape returned empty result.";

                    // Record to history
                    var newItem = new ScrapeHistoryItem
                    {
                        Url = targetUrl,
                        Timestamp = DateTime.Now.ToString("HH:mm:ss"),
                        Result = scrapeResult,
                        RawJson = rawJsonResponse
                    };

                    recentScrapes.Insert(0, newItem);
                    if (recentScrapes.Count > 10)
                    {
                        recentScrapes.RemoveAt(recentScrapes.Count - 1);
                    }

                    await SaveScrapeHistory();
                    ShowNotification("Evaluation complete!");
                }
                else
                {
                    errorMessage = $"Scrape failed ({response.StatusCode}): {rawText}";
                }
            }
            catch (Exception ex)
            {
                errorMessage = $"Error executing scraper: {ex.Message}";
            }
            finally
            {
                isExecuting = false;
            }
        }

        private void LoadFromHistory(ScrapeHistoryItem item)
        {
            targetUrl = item.Url;
            scrapeResult = item.Result;
            rawJsonResponse = item.RawJson;
            viewTab = "formatted";
            ShowNotification("Loaded from history");
        }

        private async Task CopyToClipboard()
        {
            try
            {
                var contentToCopy = viewTab == "formatted" ? scrapeResult : rawJsonResponse;
                await JS.InvokeVoidAsync("navigator.clipboard.writeText", contentToCopy);
                ShowNotification("Copied to clipboard!");
            }
            catch (Exception ex)
            {
                errorMessage = $"Copy failed: {ex.Message}";
            }
        }

        private async Task DownloadResult()
        {
            try
            {
                var content = viewTab == "formatted" ? scrapeResult : rawJsonResponse;
                var fileName = $"scrape_{DateTime.Now:yyyyMMdd_HHmmss}.txt";
                await JS.InvokeVoidAsync("zlaInterop.downloadFile", fileName, content);
                ShowNotification("Export started!");
            }
            catch (Exception ex)
            {
                errorMessage = $"Export failed: {ex.Message}";
            }
        }

        private async Task ClearHistory()
        {
            recentScrapes.Clear();
            await SaveScrapeHistory();
            ShowNotification("History cleared");
        }

        private async Task LoadScrapeHistory()
        {
            try
            {
                var json = await JS.InvokeAsync<string>("localStorage.getItem", "dgc_scrape_history");
                if (!string.IsNullOrEmpty(json))
                {
                    recentScrapes = System.Text.Json.JsonSerializer.Deserialize<List<ScrapeHistoryItem>>(json) ?? new List<ScrapeHistoryItem>();
                }
            }
            catch {}
        }

        private async Task SaveScrapeHistory()
        {
            try
            {
                var json = System.Text.Json.JsonSerializer.Serialize(recentScrapes);
                await JS.InvokeVoidAsync("localStorage.setItem", "dgc_scrape_history", json);
            }
            catch {}
        }

        private void ShowNotification(string msg)
        {
            statusNotification = msg;
            StateHasChanged();
            _ = Task.Run(async () =>
            {
                await Task.Delay(3000);
                statusNotification = string.Empty;
                await InvokeAsync(StateHasChanged);
            });
        }
    }

    public class ScrapeApiResponse
    {
        public bool Success { get; set; }
        public string TargetUrl { get; set; }
        public string Evaluation { get; set; }
        public string Timestamp { get; set; }
        public string EvaluatedBy { get; set; }
        public int CreditsDeducted { get; set; }
        public int RemainingCredits { get; set; }
    }

    public class ScrapeHistoryItem
    {
        public string Url { get; set; } = string.Empty;
        public string Timestamp { get; set; } = string.Empty;
        public string Result { get; set; } = string.Empty;
        public string RawJson { get; set; } = string.Empty;
    }
}
