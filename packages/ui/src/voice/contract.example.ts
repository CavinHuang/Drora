/**
 * voice 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 *
 * Phase 1b wiring 的标准装配：规划器经 AnnouncementLegControl 写 voiceSessionStore，
 * TTS/claim/设置读取全部依赖注入；UI 组件不直接 new 适配器、不直接写 store 播报腿。
 */
import { createSpeechSynthesisTtsAdapter } from "./speechSynthesisTtsAdapter.js";
import {
  createTurnSpeechPlanner,
  createVoiceSessionAnnouncementControl,
} from "./turnSpeechPlanner.js";
import { createWebSpeechAsrAdapter } from "./webSpeechAsrAdapter.js";
import { useVoiceSessionStore } from "@/store/voiceSessionStore.js";

export function exampleVoiceWiring(): void {
  const planner = createTurnSpeechPlanner({
    getFocusedTurnTail: () => null, // Phase 1b：从 ConversationTurnGroup 同一投影取轮尾
    tts: createSpeechSynthesisTtsAdapter(),
    claim: { acquire: async () => false, renew: async () => false, release: () => {} }, // Phase 1b 换 BroadcastHub 适配
    isAnnouncementEnabled: () => false, // Phase 1b：接 voiceAnnouncementPreferences reader
    announcementControl: createVoiceSessionAnnouncementControl(useVoiceSessionStore),
  });
  void planner;
  void createWebSpeechAsrAdapter;
}
