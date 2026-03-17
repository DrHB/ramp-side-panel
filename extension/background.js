const PANEL_BEHAVIOR = { openPanelOnActionClick: true };

async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior(PANEL_BEHAVIOR);
  } catch (error) {
    console.warn("Unable to configure side panel behavior:", error);
  }
}

function fallbackPageContext(tab) {
  return {
    url: tab?.url ?? "",
    title: tab?.title ?? "",
    text: "",
    capturedAt: new Date().toISOString(),
  };
}

async function getActivePageContext() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab) {
    return fallbackPageContext(null);
  }

  if (!tab.id) {
    return fallbackPageContext(tab);
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "extractContent",
    });
    return response ?? fallbackPageContext(tab);
  } catch {
    return fallbackPageContext(tab);
  }
}

void configureSidePanel();
chrome.runtime.onInstalled.addListener(() => void configureSidePanel());
chrome.runtime.onStartup.addListener(() => void configureSidePanel());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "getPageContent") {
    return undefined;
  }

  void getActivePageContext()
    .then((response) => sendResponse(response))
    .catch(() => sendResponse(fallbackPageContext(null)));

  return true;
});
