import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import type { ThemeMode } from "../types";

type MarkdownEditorProps = {
  value: string;
  theme: ThemeMode;
  wordWrap: boolean;
  onChange: (value: string) => void;
};

export function MarkdownEditor({ value, theme, wordWrap, onChange }: MarkdownEditorProps) {
  const editorTheme = theme === "dark" ? "dark" : "light";
  const extensions = wordWrap ? [markdown(), EditorView.lineWrapping] : [markdown()];

  return (
    <CodeMirror
      value={value}
      height="100%"
      basicSetup={{
        foldGutter: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        lineNumbers: true,
      }}
      extensions={extensions}
      theme={editorTheme}
      onChange={onChange}
    />
  );
}
