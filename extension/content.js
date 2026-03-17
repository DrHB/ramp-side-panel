chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "extractContent") {
    return undefined;
  }

  sendResponse({
    url: window.location.href,
    title: document.title,
    text: extractPageText(),
    capturedAt: new Date().toISOString(),
  });

  return true;
});

function extractPageText() {
  const source =
    document.body?.innerText ||
    document.documentElement?.innerText ||
    "";

  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 20000);
}
