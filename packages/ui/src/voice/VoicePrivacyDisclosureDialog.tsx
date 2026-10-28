/**
 * 隐私三条披露确认弹层（specs/voice-agent-integration.md §6.2 冻结成稿 / FD-5）。
 *
 * 两个开启入口（设置页任一语音开关的开启动作、入口可见未确认时点按 mic 的兜底门）
 * 共用本组件；确认后由调用方执行「中止本次动作」——确认本身不启动录音、不直接开启
 * 开关（FD-5：不做「确认即连续开录」，再次显式动作才开始）。
 */
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";

export interface VoicePrivacyDisclosureDialogProps {
  open: boolean;
  /** 显式确认：调用方置 acknowledged=true 并中止本次动作（FD-5）。 */
  onAcknowledge: () => void;
  /** 取消：本次动作回落（开关回落 / 回 Idle）。 */
  onCancel: () => void;
}

const DISCLOSURE_MESSAGE_IDS = [
  "voice.settings.privacy.asr",
  "voice.settings.privacy.persistence",
  "voice.settings.privacy.mic",
] as const;

export function VoicePrivacyDisclosureDialog({
  open,
  onAcknowledge,
  onCancel,
}: VoicePrivacyDisclosureDialogProps) {
  const { intl } = useDroraIntl();
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="max-w-xl" data-testid="voice-privacy-disclosure-dialog">
        <DialogHeader>
          <DialogTitle className="text-ui-lg">
            {intl.formatMessage({ id: "voice.settings.privacy.title" })}
          </DialogTitle>
          <DialogDescription asChild>
            <ul className="list-disc space-y-3 pl-5 text-ui-base leading-6 text-foreground-subtle">
              {DISCLOSURE_MESSAGE_IDS.map((id) => (
                <li key={id}>{intl.formatMessage({ id })}</li>
              ))}
            </ul>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="voice-privacy-cancel"
            onClick={onCancel}
          >
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
          <Button type="button" size="sm" data-testid="voice-privacy-acknowledge" onClick={onAcknowledge}>
            {intl.formatMessage({ id: "voice.settings.privacy.acknowledge" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
