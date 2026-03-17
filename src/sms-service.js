const { URL } = require("url");

async function sendSms({ phoneNumber, message, reminderId }) {
  const mode = process.env.SMS_MODE || "mock";

  if (mode === "mock") {
    const payload = {
      reminderId,
      phoneNumber,
      message,
      mode,
      simulatedAt: new Date().toISOString(),
    };
    console.log("[sms:mock]", JSON.stringify(payload));
    return {
      status: "mock_sent",
      providerResponse: JSON.stringify(payload),
    };
  }

  if (mode === "webhook") {
    const webhookUrl = process.env.SMS_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error("SMS_WEBHOOK_URL 未配置，无法使用 webhook 短信模式");
    }

    const headers = {
      "Content-Type": "application/json",
    };
    if (process.env.SMS_WEBHOOK_TOKEN) {
      headers.Authorization = `Bearer ${process.env.SMS_WEBHOOK_TOKEN}`;
    }

    const response = await fetch(new URL(webhookUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({
        reminderId,
        phoneNumber,
        message,
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`短信接口返回 ${response.status}: ${responseText}`);
    }

    return {
      status: "sent",
      providerResponse: responseText,
    };
  }

  throw new Error(`不支持的短信模式: ${mode}`);
}

module.exports = {
  sendSms,
};
