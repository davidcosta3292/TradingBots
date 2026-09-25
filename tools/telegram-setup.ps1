<#
Connects the Trading Office alerts to Telegram. Run it yourself (it asks for
your bot token, which stays on this PC):

    powershell -ExecutionPolicy Bypass -File .\tools\telegram-setup.ps1

Before running it:
  1. In Telegram, open @BotFather, send /newbot, choose a name, then a username
     ending in "bot". BotFather replies with a token like 123456:ABC-...
  2. Tap the link to your new bot and press Start. For alerts in a group with
     your friend, add the bot to the group and send a message there instead.
#>
$ErrorActionPreference = 'Stop'

$secure = Read-Host 'Paste the bot token from BotFather' -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
$api = "https://api.telegram.org/bot$token"

try {
    $me = Invoke-RestMethod "$api/getMe"
} catch {
    Write-Host 'Telegram did not accept that token. Copy it again from BotFather and retry.'
    exit 1
}
Write-Host "Found your bot: @$($me.result.username)"

# Every chat the bot has seen: private chats, and groups it was added to.
$chats = [ordered]@{}
foreach ($update in (Invoke-RestMethod "$api/getUpdates").result) {
    foreach ($part in 'message', 'my_chat_member', 'channel_post') {
        $chat = $update.$part.chat
        if ($chat) { $chats["$($chat.id)"] = $chat }
    }
}
if ($chats.Count -eq 0) {
    Write-Host 'The bot has no chats yet. Open it in Telegram and press Start (or send a message in the group), then run this again.'
    exit 1
}

$list = @($chats.Values)
for ($i = 0; $i -lt $list.Count; $i++) {
    $c = $list[$i]
    $name = if ($c.title) { $c.title } else { "$($c.first_name) $($c.last_name)".Trim() }
    Write-Host ("  [{0}] {1} ({2})" -f ($i + 1), $name, $c.type)
}
$pick = 0
if ($list.Count -gt 1) { $pick = [int](Read-Host 'Which chat should get the alerts? Type its number') - 1 }
$chat = $list[$pick]

Invoke-RestMethod "$api/sendMessage" -Method Post -Body @{
    chat_id = $chat.id
    text    = 'Trading Office alerts will arrive here.'
} | Out-Null
Write-Host 'Sent a test message. Check Telegram.'

$sql = "select public.set_telegram('$token', '$($chat.id)'); select public.telegram('Trading Office connected');"
Set-Clipboard -Value $sql
Write-Host ''
Write-Host 'Last step: the line below is on your clipboard. Paste it into the Supabase SQL Editor and press Run.'
Write-Host ''
Write-Host "  $sql"
