import { CommonData } from "applesauce-content/nast";

interface TextNodeProps {
  node: {
    type: "text";
    value: string;
    data?: CommonData;
  };
}

export function Text({ node }: TextNodeProps) {
  const text = node.value;

  // If no newlines, render as simple span
  if (!text.includes("\n")) {
    return <span dir="auto">{text}</span>;
  }

  // Multi-line text: split and render with <br /> between lines
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, idx) => (
        <span key={idx} dir="auto">
          {line}
          {idx < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}
