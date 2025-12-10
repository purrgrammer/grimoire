interface TextNodeProps {
  node: {
    type: "text";
    value: string;
  };
}

// Check if text contains RTL characters (Arabic, Hebrew, Persian, etc.)
function hasRTLCharacters(text: string): boolean {
  return /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(text);
}

export function Text({ node }: TextNodeProps) {
  const text = node.value;
  
  // If no newlines, render as inline span
  if (!text.includes("\n")) {
    const isRTL = hasRTLCharacters(text);
    return <span dir={isRTL ? "rtl" : "auto"}>{text || "\u00A0"}</span>;
  }
  
  // If has newlines, use spans with <br> tags
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, idx) => {
        const isRTL = hasRTLCharacters(line);
        return (
          <span key={idx}>
            <span dir={isRTL ? "rtl" : "auto"}>{line || "\u00A0"}</span>
            {idx < lines.length - 1 && <br />}
          </span>
        );
      })}
    </>
  );
}
