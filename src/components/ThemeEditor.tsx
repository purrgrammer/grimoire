import { useState, useEffect } from "react";
import { HslColorPicker, HslColor } from "react-colorful";
import { useTheme } from "@/lib/themes";
import type { Theme, HSLValue, RGBValue } from "@/lib/themes/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Upload, RotateCcw, Save, Eye, EyeOff } from "lucide-react";
import { applyTheme } from "@/lib/themes/apply";
import { builtinThemeList } from "@/lib/themes/builtin";

/**
 * Convert HSL string "220 70% 50%" to HslColor object
 */
function parseHSL(hsl: HSLValue): HslColor {
  const parts = hsl.split(" ");
  const h = parseFloat(parts[0] || "0");
  const s = parseFloat(parts[1]?.replace("%", "") || "0");
  const l = parseFloat(parts[2]?.replace("%", "") || "0");
  return { h, s, l };
}

/**
 * Convert HslColor object to HSL string "220 70% 50%"
 */
function formatHSL(color: HslColor): HSLValue {
  return `${Math.round(color.h)} ${Math.round(color.s)}% ${Math.round(color.l)}%`;
}

/**
 * Convert RGB string "250 204 21" to object
 */
function parseRGB(rgb: RGBValue): { r: number; g: number; b: number } {
  const parts = rgb.split(" ");
  return {
    r: parseFloat(parts[0] || "0"),
    g: parseFloat(parts[1] || "0"),
    b: parseFloat(parts[2] || "0"),
  };
}

/**
 * Convert RGB object to string "250 204 21"
 */
function formatRGB(color: { r: number; g: number; b: number }): RGBValue {
  return `${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)}`;
}

/**
 * HSL Color Picker Component
 */
interface ColorPickerProps {
  label: string;
  value: HSLValue;
  onChange: (value: HSLValue) => void;
  description?: string;
}

function ColorPicker({
  label,
  value,
  onChange,
  description,
}: ColorPickerProps) {
  const [color, setColor] = useState<HslColor>(parseHSL(value));
  const [inputValue, setInputValue] = useState(value);

  // Update local state when prop changes
  useEffect(() => {
    setColor(parseHSL(value));
    setInputValue(value);
  }, [value]);

  const handleColorChange = (newColor: HslColor) => {
    setColor(newColor);
    const hslString = formatHSL(newColor);
    setInputValue(hslString);
    onChange(hslString);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    // Try to parse and update if valid
    try {
      const parsed = parseHSL(val);
      setColor(parsed);
      onChange(val);
    } catch {
      // Invalid format, don't update
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <div className="flex gap-3 items-start">
        <div className="flex-shrink-0">
          <HslColorPicker color={color} onChange={handleColorChange} />
        </div>
        <div className="flex-1 space-y-2">
          <Input
            value={inputValue}
            onChange={handleInputChange}
            className="font-mono text-sm"
            placeholder="220 70% 50%"
          />
          <div
            className="h-12 rounded border-2 border-border"
            style={{ background: `hsl(${value})` }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * RGB Color Picker Component (for gradients)
 */
interface RGBPickerProps {
  label: string;
  value: RGBValue;
  onChange: (value: RGBValue) => void;
}

function RGBPicker({ label, value, onChange }: RGBPickerProps) {
  const rgb = parseRGB(value);

  const handleChange = (channel: "r" | "g" | "b", val: number) => {
    const newRgb = { ...rgb, [channel]: Math.max(0, Math.min(255, val)) };
    onChange(formatRGB(newRgb));
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex gap-2">
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">R</Label>
          <Input
            type="number"
            min="0"
            max="255"
            value={rgb.r}
            onChange={(e) => handleChange("r", parseInt(e.target.value))}
            className="font-mono text-sm"
          />
        </div>
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">G</Label>
          <Input
            type="number"
            min="0"
            max="255"
            value={rgb.g}
            onChange={(e) => handleChange("g", parseInt(e.target.value))}
            className="font-mono text-sm"
          />
        </div>
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">B</Label>
          <Input
            type="number"
            min="0"
            max="255"
            value={rgb.b}
            onChange={(e) => handleChange("b", parseInt(e.target.value))}
            className="font-mono text-sm"
          />
        </div>
      </div>
      <div
        className="h-12 rounded border-2 border-border"
        style={{ background: `rgb(${value})` }}
      />
    </div>
  );
}

/**
 * Main Theme Editor Component
 */
export function ThemeEditor() {
  const { theme: currentTheme, addCustomTheme, availableThemes } = useTheme();
  const [editingTheme, setEditingTheme] = useState<Theme>(
    JSON.parse(JSON.stringify(currentTheme)),
  );
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [baseThemeId, setBaseThemeId] = useState(currentTheme.id);

  // Apply preview in real-time
  useEffect(() => {
    if (previewEnabled) {
      applyTheme(editingTheme);
    }
  }, [editingTheme, previewEnabled]);

  // Cleanup: restore original theme when preview is disabled or component unmounts
  useEffect(() => {
    return () => {
      if (previewEnabled) {
        applyTheme(currentTheme);
      }
    };
  }, [currentTheme, previewEnabled]);

  const handleBaseThemeChange = (themeId: string) => {
    setBaseThemeId(themeId);
    const baseTheme = availableThemes.find((t) => t.id === themeId);
    if (baseTheme) {
      setEditingTheme(JSON.parse(JSON.stringify(baseTheme)));
    }
  };

  const handleColorChange = (path: string, value: HSLValue | RGBValue) => {
    setEditingTheme((prev) => {
      const updated = JSON.parse(JSON.stringify(prev));
      const keys = path.split(".");
      let obj: any = updated;
      for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return updated;
    });
  };

  const handleMetadataChange = (
    field: "id" | "name" | "description" | "author" | "version",
    value: string,
  ) => {
    setEditingTheme((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    addCustomTheme(editingTheme);
    alert(`Theme "${editingTheme.name}" saved successfully!`);
  };

  const handleExport = () => {
    const json = JSON.stringify(editingTheme, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${editingTheme.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const imported = JSON.parse(e.target?.result as string);
            setEditingTheme(imported);
            alert("Theme imported successfully!");
          } catch {
            alert("Failed to import theme. Invalid JSON.");
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleReset = () => {
    if (confirm("Reset to base theme? Unsaved changes will be lost.")) {
      const baseTheme = availableThemes.find((t) => t.id === baseThemeId);
      if (baseTheme) {
        setEditingTheme(JSON.parse(JSON.stringify(baseTheme)));
      }
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Theme Editor</h2>
          <div className="flex items-center gap-2">
            <Button
              variant={previewEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => setPreviewEnabled(!previewEnabled)}
            >
              {previewEnabled ? (
                <>
                  <Eye className="w-4 h-4 mr-2" />
                  Live Preview On
                </>
              ) : (
                <>
                  <EyeOff className="w-4 h-4 mr-2" />
                  Live Preview Off
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Theme ID</Label>
            <Input
              value={editingTheme.id}
              onChange={(e) => handleMetadataChange("id", e.target.value)}
              className="h-8 text-sm"
              placeholder="my-theme"
            />
          </div>
          <div>
            <Label className="text-xs">Theme Name</Label>
            <Input
              value={editingTheme.name}
              onChange={(e) => handleMetadataChange("name", e.target.value)}
              className="h-8 text-sm"
              placeholder="My Theme"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Select value={baseThemeId} onValueChange={handleBaseThemeChange}>
            <SelectTrigger className="h-8 text-sm flex-1">
              <SelectValue placeholder="Base theme" />
            </SelectTrigger>
            <SelectContent>
              {builtinThemeList.map((theme) => (
                <SelectItem key={theme.id} value={theme.id}>
                  {theme.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </Button>
          <Button variant="outline" size="sm" onClick={handleImport}>
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Save
          </Button>
        </div>
      </div>

      {/* Editor Tabs */}
      <ScrollArea className="flex-1">
        <Tabs defaultValue="core" className="p-4">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="core">Core Colors</TabsTrigger>
            <TabsTrigger value="syntax">Syntax</TabsTrigger>
            <TabsTrigger value="scrollbar">Scrollbar</TabsTrigger>
            <TabsTrigger value="gradient">Gradient</TabsTrigger>
          </TabsList>

          {/* Core Colors */}
          <TabsContent value="core" className="space-y-4 mt-4">
            <Accordion type="multiple" className="w-full">
              <AccordionItem value="surfaces">
                <AccordionTrigger>Surfaces</AccordionTrigger>
                <AccordionContent className="space-y-6 pt-4">
                  <ColorPicker
                    label="Background"
                    value={editingTheme.colors.background}
                    onChange={(v) => handleColorChange("colors.background", v)}
                    description="Main app background"
                  />
                  <ColorPicker
                    label="Foreground"
                    value={editingTheme.colors.foreground}
                    onChange={(v) => handleColorChange("colors.foreground", v)}
                    description="Main text color"
                  />
                  <ColorPicker
                    label="Card"
                    value={editingTheme.colors.card}
                    onChange={(v) => handleColorChange("colors.card", v)}
                    description="Card/panel background"
                  />
                  <ColorPicker
                    label="Card Foreground"
                    value={editingTheme.colors.cardForeground}
                    onChange={(v) =>
                      handleColorChange("colors.cardForeground", v)
                    }
                    description="Text on cards"
                  />
                  <ColorPicker
                    label="Popover"
                    value={editingTheme.colors.popover}
                    onChange={(v) => handleColorChange("colors.popover", v)}
                    description="Popover/dropdown background"
                  />
                  <ColorPicker
                    label="Popover Foreground"
                    value={editingTheme.colors.popoverForeground}
                    onChange={(v) =>
                      handleColorChange("colors.popoverForeground", v)
                    }
                    description="Text in popovers"
                  />
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="interactive">
                <AccordionTrigger>Interactive Elements</AccordionTrigger>
                <AccordionContent className="space-y-6 pt-4">
                  <ColorPicker
                    label="Primary"
                    value={editingTheme.colors.primary}
                    onChange={(v) => handleColorChange("colors.primary", v)}
                    description="Primary buttons and interactive elements"
                  />
                  <ColorPicker
                    label="Primary Foreground"
                    value={editingTheme.colors.primaryForeground}
                    onChange={(v) =>
                      handleColorChange("colors.primaryForeground", v)
                    }
                    description="Text on primary elements"
                  />
                  <ColorPicker
                    label="Secondary"
                    value={editingTheme.colors.secondary}
                    onChange={(v) => handleColorChange("colors.secondary", v)}
                    description="Secondary buttons"
                  />
                  <ColorPicker
                    label="Secondary Foreground"
                    value={editingTheme.colors.secondaryForeground}
                    onChange={(v) =>
                      handleColorChange("colors.secondaryForeground", v)
                    }
                    description="Text on secondary elements"
                  />
                  <ColorPicker
                    label="Accent"
                    value={editingTheme.colors.accent}
                    onChange={(v) => handleColorChange("colors.accent", v)}
                    description="Accent/highlight color"
                  />
                  <ColorPicker
                    label="Accent Foreground"
                    value={editingTheme.colors.accentForeground}
                    onChange={(v) =>
                      handleColorChange("colors.accentForeground", v)
                    }
                    description="Text on accent elements"
                  />
                  <ColorPicker
                    label="Muted"
                    value={editingTheme.colors.muted}
                    onChange={(v) => handleColorChange("colors.muted", v)}
                    description="Muted/subdued elements"
                  />
                  <ColorPicker
                    label="Muted Foreground"
                    value={editingTheme.colors.mutedForeground}
                    onChange={(v) =>
                      handleColorChange("colors.mutedForeground", v)
                    }
                    description="Text on muted elements"
                  />
                  <ColorPicker
                    label="Destructive"
                    value={editingTheme.colors.destructive}
                    onChange={(v) => handleColorChange("colors.destructive", v)}
                    description="Destructive/error actions"
                  />
                  <ColorPicker
                    label="Destructive Foreground"
                    value={editingTheme.colors.destructiveForeground}
                    onChange={(v) =>
                      handleColorChange("colors.destructiveForeground", v)
                    }
                    description="Text on destructive elements"
                  />
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="forms">
                <AccordionTrigger>Form Elements</AccordionTrigger>
                <AccordionContent className="space-y-6 pt-4">
                  <ColorPicker
                    label="Border"
                    value={editingTheme.colors.border}
                    onChange={(v) => handleColorChange("colors.border", v)}
                    description="Border color"
                  />
                  <ColorPicker
                    label="Input"
                    value={editingTheme.colors.input}
                    onChange={(v) => handleColorChange("colors.input", v)}
                    description="Input background"
                  />
                  <ColorPicker
                    label="Ring"
                    value={editingTheme.colors.ring}
                    onChange={(v) => handleColorChange("colors.ring", v)}
                    description="Focus ring color"
                  />
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="status">
                <AccordionTrigger>Status & Feedback</AccordionTrigger>
                <AccordionContent className="space-y-6 pt-4">
                  <ColorPicker
                    label="Success"
                    value={editingTheme.colors.success}
                    onChange={(v) => handleColorChange("colors.success", v)}
                    description="Success states"
                  />
                  <ColorPicker
                    label="Warning"
                    value={editingTheme.colors.warning}
                    onChange={(v) => handleColorChange("colors.warning", v)}
                    description="Warning states"
                  />
                  <ColorPicker
                    label="Info"
                    value={editingTheme.colors.info}
                    onChange={(v) => handleColorChange("colors.info", v)}
                    description="Info states"
                  />
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="nostr">
                <AccordionTrigger>Nostr-Specific</AccordionTrigger>
                <AccordionContent className="space-y-6 pt-4">
                  <ColorPicker
                    label="Zap"
                    value={editingTheme.colors.zap}
                    onChange={(v) => handleColorChange("colors.zap", v)}
                    description="Lightning zap color"
                  />
                  <ColorPicker
                    label="Live"
                    value={editingTheme.colors.live}
                    onChange={(v) => handleColorChange("colors.live", v)}
                    description="Live streaming indicator"
                  />
                  <ColorPicker
                    label="Highlight"
                    value={editingTheme.colors.highlight}
                    onChange={(v) => handleColorChange("colors.highlight", v)}
                    description="User highlight color"
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </TabsContent>

          {/* Syntax Highlighting */}
          <TabsContent value="syntax" className="space-y-6 mt-4">
            <div className="space-y-6">
              <ColorPicker
                label="Comment"
                value={editingTheme.syntax.comment}
                onChange={(v) => handleColorChange("syntax.comment", v)}
              />
              <ColorPicker
                label="Punctuation"
                value={editingTheme.syntax.punctuation}
                onChange={(v) => handleColorChange("syntax.punctuation", v)}
              />
              <ColorPicker
                label="Property"
                value={editingTheme.syntax.property}
                onChange={(v) => handleColorChange("syntax.property", v)}
              />
              <ColorPicker
                label="String"
                value={editingTheme.syntax.string}
                onChange={(v) => handleColorChange("syntax.string", v)}
              />
              <ColorPicker
                label="Keyword"
                value={editingTheme.syntax.keyword}
                onChange={(v) => handleColorChange("syntax.keyword", v)}
              />
              <ColorPicker
                label="Function"
                value={editingTheme.syntax.function}
                onChange={(v) => handleColorChange("syntax.function", v)}
              />
              <ColorPicker
                label="Variable"
                value={editingTheme.syntax.variable}
                onChange={(v) => handleColorChange("syntax.variable", v)}
              />
              <ColorPicker
                label="Operator"
                value={editingTheme.syntax.operator}
                onChange={(v) => handleColorChange("syntax.operator", v)}
              />
              <ColorPicker
                label="Diff Inserted"
                value={editingTheme.syntax.diffInserted}
                onChange={(v) => handleColorChange("syntax.diffInserted", v)}
              />
              <ColorPicker
                label="Diff Inserted Background"
                value={editingTheme.syntax.diffInsertedBg}
                onChange={(v) => handleColorChange("syntax.diffInsertedBg", v)}
              />
              <ColorPicker
                label="Diff Deleted"
                value={editingTheme.syntax.diffDeleted}
                onChange={(v) => handleColorChange("syntax.diffDeleted", v)}
              />
              <ColorPicker
                label="Diff Deleted Background"
                value={editingTheme.syntax.diffDeletedBg}
                onChange={(v) => handleColorChange("syntax.diffDeletedBg", v)}
              />
              <ColorPicker
                label="Diff Meta"
                value={editingTheme.syntax.diffMeta}
                onChange={(v) => handleColorChange("syntax.diffMeta", v)}
              />
              <ColorPicker
                label="Diff Meta Background"
                value={editingTheme.syntax.diffMetaBg}
                onChange={(v) => handleColorChange("syntax.diffMetaBg", v)}
              />
            </div>
          </TabsContent>

          {/* Scrollbar */}
          <TabsContent value="scrollbar" className="space-y-6 mt-4">
            <ColorPicker
              label="Thumb"
              value={editingTheme.scrollbar.thumb}
              onChange={(v) => handleColorChange("scrollbar.thumb", v)}
              description="Scrollbar thumb color"
            />
            <ColorPicker
              label="Thumb Hover"
              value={editingTheme.scrollbar.thumbHover}
              onChange={(v) => handleColorChange("scrollbar.thumbHover", v)}
              description="Scrollbar thumb hover color"
            />
            <ColorPicker
              label="Track"
              value={editingTheme.scrollbar.track}
              onChange={(v) => handleColorChange("scrollbar.track", v)}
              description="Scrollbar track color"
            />
          </TabsContent>

          {/* Gradient */}
          <TabsContent value="gradient" className="space-y-6 mt-4">
            <RGBPicker
              label="Color 1 (Top - Yellow)"
              value={editingTheme.gradient.color1}
              onChange={(v) => handleColorChange("gradient.color1", v)}
            />
            <RGBPicker
              label="Color 2 (Upper-Middle - Orange)"
              value={editingTheme.gradient.color2}
              onChange={(v) => handleColorChange("gradient.color2", v)}
            />
            <RGBPicker
              label="Color 3 (Lower-Middle - Purple)"
              value={editingTheme.gradient.color3}
              onChange={(v) => handleColorChange("gradient.color3", v)}
            />
            <RGBPicker
              label="Color 4 (Bottom - Cyan)"
              value={editingTheme.gradient.color4}
              onChange={(v) => handleColorChange("gradient.color4", v)}
            />
            <div className="space-y-2">
              <Label>Preview</Label>
              <div
                className="h-32 rounded border-2 border-border"
                style={{
                  background: `linear-gradient(to bottom, rgb(${editingTheme.gradient.color1}), rgb(${editingTheme.gradient.color2}), rgb(${editingTheme.gradient.color3}), rgb(${editingTheme.gradient.color4}))`,
                }}
              />
            </div>
          </TabsContent>
        </Tabs>
      </ScrollArea>
    </div>
  );
}
