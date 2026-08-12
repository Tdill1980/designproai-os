import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Button } from "@/components/ui/button";
import {
  Bold,
  Italic,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Image as ImageIcon,
  Undo,
  Redo,
  Code,
} from "lucide-react";
import { useEffect } from "react";

interface TipTapEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export function TipTapEditor({ value, onChange, placeholder }: TipTapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener", target: "_blank" },
      }),
      Image,
      Placeholder.configure({
        placeholder: placeholder ?? "Start writing your post…",
      }),
      CharacterCount,
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-invert max-w-none min-h-[400px] focus:outline-none px-4 py-3",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value && value !== editor.getHTML()) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  if (!editor) return <div className="h-96 bg-zinc-900 rounded-md animate-pulse" />;

  function setLink() {
    const previousUrl = editor!.getAttributes("link").href;
    const url = window.prompt("URL (use a relative path like /products/foo for internal links)", previousUrl);
    if (url === null) return;
    if (url === "") {
      editor!.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor!.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  function addImage() {
    const url = window.prompt("Image URL");
    if (!url) return;
    editor!.chain().focus().setImage({ src: url }).run();
  }

  return (
    <div className="border border-zinc-800 rounded-md bg-zinc-950">
      <div className="flex flex-wrap gap-1 border-b border-zinc-800 px-2 py-1.5">
        <ToolbarBtn
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          icon={<Bold className="h-4 w-4" />}
        />
        <ToolbarBtn
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          icon={<Italic className="h-4 w-4" />}
        />
        <div className="w-px bg-zinc-800 mx-1" />
        <ToolbarBtn
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          icon={<Heading2 className="h-4 w-4" />}
        />
        <ToolbarBtn
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          icon={<Heading3 className="h-4 w-4" />}
        />
        <div className="w-px bg-zinc-800 mx-1" />
        <ToolbarBtn
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          icon={<List className="h-4 w-4" />}
        />
        <ToolbarBtn
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          icon={<ListOrdered className="h-4 w-4" />}
        />
        <ToolbarBtn
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          icon={<Quote className="h-4 w-4" />}
        />
        <ToolbarBtn
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          icon={<Code className="h-4 w-4" />}
        />
        <div className="w-px bg-zinc-800 mx-1" />
        <ToolbarBtn
          active={editor.isActive("link")}
          onClick={setLink}
          icon={<LinkIcon className="h-4 w-4" />}
        />
        <ToolbarBtn active={false} onClick={addImage} icon={<ImageIcon className="h-4 w-4" />} />
        <div className="ml-auto flex items-center gap-1">
          <ToolbarBtn
            active={false}
            onClick={() => editor.chain().focus().undo().run()}
            icon={<Undo className="h-4 w-4" />}
          />
          <ToolbarBtn
            active={false}
            onClick={() => editor.chain().focus().redo().run()}
            icon={<Redo className="h-4 w-4" />}
          />
        </div>
      </div>
      <EditorContent editor={editor} />
      <div className="border-t border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 flex justify-between">
        <span>{editor.storage.characterCount.words()} words</span>
        <span>{editor.storage.characterCount.characters()} characters</span>
      </div>
    </div>
  );
}

function ToolbarBtn({
  active,
  onClick,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className="h-8 w-8 p-0"
      onClick={onClick}
    >
      {icon}
    </Button>
  );
}
