package com.coldvoice.text

/**
 * Kotlin port of the core steps in packages/shared/text-processing.
 * Deterministic, offline. Keep behaviour in sync with the JS source of truth.
 */
object TextPipeline {

    data class DictEntry(val phrase: String, val replacement: String, val caseSensitive: Boolean = false)
    data class Snippet(val trigger: String, val expansion: String, val enabled: Boolean = true)

    private val ALWAYS_FILLERS = listOf("um", "umm", "uh", "uhh", "er", "err", "erm", "ah", "hmm", "mm")

    fun process(
        raw: String,
        dictionary: List<DictEntry> = emptyList(),
        snippets: List<Snippet> = emptyList(),
        style: String = "default"
    ): String {
        var t = normalizeWhitespace(raw)
        if (style.lowercase() == "raw") return t
        t = convertSpokenPunctuation(t)
        t = removeFillers(t)
        t = applyFormatting(t)
        t = applyDictionary(t, dictionary)
        t = expandSnippets(t, snippets)
        return t.trim()
    }

    private fun normalizeWhitespace(s: String): String =
        s.replace("\r\n", "\n").replace(Regex("[ \t]+"), " ").replace(Regex(" *\n *"), "\n").trim()

    fun convertSpokenPunctuation(text: String): String {
        var o = text
        val phrases = listOf(
            Regex("\\bnew paragraph\\b", RegexOption.IGNORE_CASE) to "\n\n",
            Regex("\\bnew line\\b", RegexOption.IGNORE_CASE) to "\n",
            Regex("\\bquestion mark\\b", RegexOption.IGNORE_CASE) to "?",
            Regex("\\bexclamation (mark|point)\\b", RegexOption.IGNORE_CASE) to "!",
            Regex("\\bfull stop\\b", RegexOption.IGNORE_CASE) to ".",
            Regex("\\bsemicolon\\b", RegexOption.IGNORE_CASE) to ";",
            Regex("\\bcolon\\b", RegexOption.IGNORE_CASE) to ":",
            Regex("\\bcomma\\b", RegexOption.IGNORE_CASE) to ",",
            Regex("\\bperiod\\b", RegexOption.IGNORE_CASE) to ".",
            Regex("\\bdash\\b", RegexOption.IGNORE_CASE) to "-"
        )
        for ((re, rep) in phrases) o = re.replace(o, rep)
        o = Regex("[ \t]+([,.;:!?])").replace(o, "$1")
        o = Regex("[ \t]*\n[ \t]*").replace(o, "\n")
        return o
    }

    fun removeFillers(text: String): String {
        var o = Regex("\\b(${ALWAYS_FILLERS.joinToString("|")})\\b", RegexOption.IGNORE_CASE).replace(text, "")
        o = Regex("\\byou know\\b", RegexOption.IGNORE_CASE).replace(o, "")
        o = Regex(",\\s*like\\s*,", RegexOption.IGNORE_CASE).replace(o, ",")
        o = Regex("[ \t]{2,}").replace(o, " ")
        o = Regex("[ \t]+([,.;:!?])").replace(o, "$1")
        return o.trim()
    }

    private fun applyFormatting(text: String): String {
        var o = Regex("([!?.,;:])\\1+").replace(text) { it.value.first().toString() }
        // Capitalize sentence starts.
        o = Regex("(^|[.!?]\\s+|\\n+)([a-z])").replace(o) { m ->
            m.groupValues[1] + m.groupValues[2].uppercase()
        }
        o = Regex("\\bi\\b").replace(o, "I")
        return o
    }

    private fun applyDictionary(text: String, entries: List<DictEntry>): String {
        var o = text
        for (e in entries) {
            val opts = if (e.caseSensitive) setOf() else setOf(RegexOption.IGNORE_CASE)
            o = Regex("\\b${Regex.escape(e.phrase)}\\b", opts).replace(o) { matchCase(it.value, e.replacement) }
        }
        return o
    }

    private fun expandSnippets(text: String, snippets: List<Snippet>): String {
        var o = text
        for (s in snippets) {
            if (!s.enabled) continue
            o = Regex("\\b${Regex.escape(s.trigger)}\\b", RegexOption.IGNORE_CASE).replace(o, s.expansion)
        }
        return o
    }

    private fun matchCase(source: String, replacement: String): String {
        if (source == source.uppercase() && source.any { it.isLetter() }) return replacement.uppercase()
        if (source.isNotEmpty() && source[0].isUpperCase()) {
            return replacement.replaceFirstChar { it.uppercase() }
        }
        return replacement
    }
}
