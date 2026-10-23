"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { Bold, Italic, List, ListOrdered, Link as LinkIcon, Quote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const MenuBar = ({ editor }: { editor: any }) => {
  if (!editor) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 p-2 border-b border-border/50 bg-muted/20 rounded-t-xl">
      <button
        onClick={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        className={cn("p-1.5 rounded hover:bg-muted transition-colors", editor.isActive('bold') ? 'bg-muted text-foreground' : 'text-muted-foreground')}
      >
        <Bold className="h-4 w-4" />
      </button>
      <button
        onClick={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        className={cn("p-1.5 rounded hover:bg-muted transition-colors", editor.isActive('italic') ? 'bg-muted text-foreground' : 'text-muted-foreground')}
      >
        <Italic className="h-4 w-4" />
      </button>
      <div className="w-px h-4 bg-border/50 mx-1" />
      <button
        onClick={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }}
        className={cn("p-1.5 rounded hover:bg-muted transition-colors", editor.isActive('bulletList') ? 'bg-muted text-foreground' : 'text-muted-foreground')}
      >
        <List className="h-4 w-4" />
      </button>
      <button
        onClick={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }}
        className={cn("p-1.5 rounded hover:bg-muted transition-colors", editor.isActive('orderedList') ? 'bg-muted text-foreground' : 'text-muted-foreground')}
      >
        <ListOrdered className="h-4 w-4" />
      </button>
      <button
        onClick={(e) => { e.preventDefault(); editor.chain().focus().toggleBlockquote().run(); }}
        className={cn("p-1.5 rounded hover:bg-muted transition-colors", editor.isActive('blockquote') ? 'bg-muted text-foreground' : 'text-muted-foreground')}
      >
        <Quote className="h-4 w-4" />
      </button>
      <div className="w-px h-4 bg-border/50 mx-1" />
      <button
        onClick={(e) => {
          e.preventDefault();
          const rawUrl = window.prompt('URL');
          if (rawUrl) {
            const trimmed = rawUrl.trim();
            if (/^(javascript|data|vbscript):/i.test(trimmed)) {
              alert('Invalid link protocol: only http:// and https:// URLs are permitted');
              return;
            }
            const validUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
            editor.chain().focus().extendMarkRange('link').setLink({ href: validUrl }).run();
          } else if (rawUrl === '') {
            editor.chain().focus().unsetLink().run();
          }
        }}
        className={cn("p-1.5 rounded hover:bg-muted transition-colors", editor.isActive('link') ? 'bg-muted text-foreground' : 'text-muted-foreground')}
      >
        <LinkIcon className="h-4 w-4" />
      </button>
    </div>
  );
};

export function RichTextEditor({ value, onChange, placeholder = "Type something...", className, disabled = false }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        isAllowedUri: (url, ctx) => {
          return /^https?:\/\//i.test(url) && ctx.defaultValidate(url);
        },
      }),
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        className: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 min-h-[110px] p-3.5 text-sm',
      },
    },
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  return (
    <div className={cn("border border-border/70 rounded-xl overflow-hidden bg-background transition-all focus-within:ring-1 focus-within:ring-primary/40 focus-within:border-primary/50", className, disabled && "opacity-50 pointer-events-none")}>
      <MenuBar editor={editor} />
      <EditorContent editor={editor} className="bg-background text-foreground [&_.ProseMirror]:outline-none [&_.ProseMirror]:focus:outline-none [&_.ProseMirror]:focus-visible:outline-none [&_.ProseMirror]:min-h-[110px]" />
    </div>
  );
}