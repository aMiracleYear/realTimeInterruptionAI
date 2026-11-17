export type WireEvent = { type: string; [key: string]: unknown };
export function isBackchannel(text: string) {
  return /^(?:(?:uh huh|uh-huh|mhm|mm hmm|yeah|yes|right|okay|ok|sure|got it|i see|thanks|thank you)[, .!?]*)+$/i.test(
    text.trim(),
  );
}
export function wantsFloor(text: string) {
  return (
    !isBackchannel(text) &&
    (/^(?:stop|wait|hold on|excuse me|actually|no[, ]|let me|can i|could you|i disagree)\b/i.test(
      text.trim(),
    ) ||
      text.trim().split(/\s+/).length >= 3)
  );
}
export function cancellationEvents(
  responseId: string | undefined,
  itemId: string | undefined,
  playedMs: number,
): WireEvent[] {
  return [
    {
      type: "response.cancel",
      ...(responseId ? { response_id: responseId } : {}),
    },
    { type: "output_audio_buffer.clear" },
    ...(itemId
      ? [
          {
            type: "conversation.item.truncate",
            item_id: itemId,
            content_index: 0,
            audio_end_ms: Math.max(0, Math.floor(playedMs)),
          },
        ]
      : []),
  ];
}
