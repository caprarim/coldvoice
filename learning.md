# Learning — ColdVoice

## Android IME enablement is two steps
Enabling a keyboard in Android system settings only makes it *available* — it does not
make it active. The user must still **switch** to it from a focused text field via the
input-method picker (`InputMethodManager.showInputMethodPicker()`). Onboarding must
surface that second step (and ideally a text field to try it in), or users get stuck
thinking "nothing happened." Check enabled state with `imm.enabledInputMethodList`, and
the active one with `Settings.Secure.DEFAULT_INPUT_METHOD`.

## Keep secrets out of source, inject at build
A live API key in committed source triggers GitHub push protection and gets scraped.
The fix: read it from gitignored `local.properties` (or an env var) and expose it via
`BuildConfig` at build time. Source stays clean; binaries still ship with the key.
