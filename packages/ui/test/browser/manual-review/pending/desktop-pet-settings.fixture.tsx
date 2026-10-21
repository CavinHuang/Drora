import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { IPlatformService, Locale, DesktopPetLibraryRequest } from "@drora/shared";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { DesktopPetSettingsRow } from "@/settings/DesktopPetSettingsRow.js";
import { desktopPetCreationPrompt } from "@/settings/desktopPetCreationPrompt.js";
import "@/styles.css";

const params = new URLSearchParams(location.search);
const locale = (params.get("locale") ?? "en-US") as Locale;
document.documentElement.className =
  params.get("theme") === "light" ? "theme-zai-light" : "dark theme-zai-dark";
function Fixture() {
  const [character, setCharacter] = useState("violet");
  const [size, setSize] = useState(112);
  const [enabled, setEnabled] = useState(false);
  const [prompt, setPrompt] = useState("");
  const platform = useMemo(
    () =>
      ({
        manageDesktopPets: async (request: DesktopPetLibraryRequest) => {
          const response = await fetch("/pet-library", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
          });
          return response.json();
        },
      }) as IPlatformService,
    [],
  );
  return (
    <PlatformProvider platform={platform}>
      <DroraIntlProvider initialLocale={locale}>
        <main className="min-h-screen bg-background p-4 text-foreground">
          <div className="mx-auto max-w-3xl">
            <DesktopPetSettingsRow
              checked={enabled}
              character={character}
              size={size}
              onChange={setEnabled}
              onCharacterChange={setCharacter}
              onSizeChange={setSize}
              onCreatePet={(directory) => setPrompt(desktopPetCreationPrompt(directory, locale))}
              onUpgradePet={(directory, source) =>
                setPrompt(desktopPetCreationPrompt(directory, locale, source))
              }
            />
            <output data-testid="pet-settings-state" className="hidden">
              {JSON.stringify({ character, size, enabled })}
            </output>
            {prompt ? (
              <p data-testid="pet-created-prompt" className="hidden">
                {prompt}
              </p>
            ) : null}
          </div>
        </main>
      </DroraIntlProvider>
    </PlatformProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
