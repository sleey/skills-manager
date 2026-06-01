import { useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

type MarkdownPreviewProps = {
  content: string;
};

const components: Components = {
  code(props) {
    const { children, className, ...rest } = props;
    const code = String(children).replace(/\n$/, "");
    const language = className?.replace("language-", "");

    if (!language) {
      return (
        <code className="inline-code" {...rest}>
          {children}
        </code>
      );
    }

    return <HighlightedCode code={code} language={language} />;
  },
};

function HighlightedCode({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;

    import("shiki")
      .then(({ codeToHtml }) =>
        codeToHtml(code, {
          lang: language,
          theme: "github-dark-default",
        }),
      )
      .then((result) => {
        if (!cancelled) {
          setHtml(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (!html) {
    return <pre className="code-block">{code}</pre>;
  }

  return <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />;
}

function stripFrontmatter(content: string) {
  if (!content.startsWith("---")) {
    return content;
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) {
    return content;
  }

  return normalized.slice(end + 4).trimStart();
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {stripFrontmatter(content)}
      </ReactMarkdown>
    </div>
  );
}
