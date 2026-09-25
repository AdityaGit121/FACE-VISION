import React, { useState } from 'react';
import {
  Sparkles,
  Send,
  Terminal,
  Bot,
  User,
  Zap,
  Crosshair,
  Search,
  Scan,
  Users,
} from 'lucide-react';
import { TrackedFace, IdentityProfile, TargetState } from '../types';
import { parseLocalCommand, dispatchServerAssistantCommand, ParsedCommand } from '../commands/visionCommands';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  intent?: string;
  timestamp: number;
}

interface VisionAssistantProps {
  faces: TrackedFace[];
  enrolledProfiles: IdentityProfile[];
  targetState: TargetState;
  onLockTarget: (name: string, face: TrackedFace | null, personId?: string) => void;
  onUnlockTarget: () => void;
  onSearchTarget: (name: string) => void;
  onSelectTrack: (trackId: number) => void;
  onTriggerDeepScan: () => void;
  onOpenMemory: () => void;
  hasGeminiKey: boolean;
}

export const VisionAssistant: React.FC<VisionAssistantProps> = ({
  faces,
  enrolledProfiles,
  targetState,
  onLockTarget,
  onUnlockTarget,
  onSearchTarget,
  onSelectTrack,
  onTriggerDeepScan,
  onOpenMemory,
  hasGeminiKey,
}) => {
  const [input, setInput] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg-init',
      sender: 'assistant',
      text: 'Vision Assistant online. Ask questions about the scene or give camera commands like "Find Alex", "Who is visible?", or "Run deep scan".',
      timestamp: Date.now(),
    },
  ]);

  const quickPrompts = [
    'Who is currently visible?',
    'Find Alex',
    'Run a deep scan',
    'How many people are in frame?',
    'Unlock target',
    'List enrolled identities',
  ];

  const handleExecuteCommand = async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query || isProcessing) return;

    const userMsg: Message = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsProcessing(true);

    try {
      // 1. Try instantaneous local parsing
      let parsed: ParsedCommand | null = parseLocalCommand(
        query,
        faces,
        enrolledProfiles,
        targetState
      );

      // 2. If not matched locally and Gemini server is connected, dispatch to Gemini
      if (!parsed && hasGeminiKey) {
        const sceneContext = {
          visiblePersonsCount: faces.length,
          visibleIdentities: faces
            .filter((f) => f.identity.status === 'KNOWN' && f.identity.name)
            .map((f) => f.identity.name),
          targetState,
          enrolledNames: enrolledProfiles.map((p) => p.name),
        };
        parsed = await dispatchServerAssistantCommand(query, sceneContext);
      }

      // Default fallback if offline or unrecognized
      if (!parsed) {
        parsed = {
          intent: 'UNKNOWN',
          spokenResponse: `Command received. Currently tracking ${faces.length} person(s). Target state is ${
            targetState.locked ? targetState.name : 'idle'
          }.`,
        };
      }

      // 3. Execute side effects on the workstation
      switch (parsed.intent) {
        case 'FIND_TARGET':
          if (parsed.targetName) {
            onSearchTarget(parsed.targetName);
          }
          break;
        case 'LOCK_TARGET':
          if (parsed.targetName) {
            onSearchTarget(parsed.targetName);
          } else if (faces.length > 0) {
            onLockTarget(faces[0].identity.name || 'Target', faces[0]);
          }
          break;
        case 'UNLOCK_TARGET':
        case 'CLEAR_TARGET':
          onUnlockTarget();
          break;
        case 'DEEP_SCAN':
          onTriggerDeepScan();
          break;
        case 'SELECT_FACE':
          if (typeof parsed.faceIndex === 'number') {
            onSelectTrack(parsed.faceIndex);
          }
          break;
        case 'LIST_IDENTITIES':
        case 'SHOW_HISTORY':
          onOpenMemory();
          break;
        default:
          break;
      }

      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        sender: 'assistant',
        text: parsed.spokenResponse,
        intent: parsed.intent,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      console.error('Assistant execution failed:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          text: `Command error: ${err?.message || 'Execution failed'}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 shadow-xl flex flex-col gap-3 font-mono">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <h2 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
            Natural-Language CV Assistant
          </h2>
        </div>
        <span className="text-[10px] text-zinc-500 flex items-center gap-1">
          <Zap className="w-3 h-3 text-emerald-400" />
          <span>Local Dispatcher</span>
        </span>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex flex-col gap-2.5 max-h-56 overflow-y-auto pr-1 text-xs">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`p-2.5 rounded-lg flex flex-col gap-1 border ${
              m.sender === 'user'
                ? 'bg-zinc-800/80 text-zinc-100 border-zinc-700 ml-6'
                : 'bg-zinc-950/80 text-zinc-300 border-zinc-800/90 mr-4'
            }`}
          >
            <div className="flex items-center justify-between text-[10px] text-zinc-500">
              <span className="flex items-center gap-1 font-bold">
                {m.sender === 'user' ? (
                  <>
                    <User className="w-3 h-3 text-cyan-400" />
                    <span className="text-cyan-400">OPERATOR</span>
                  </>
                ) : (
                  <>
                    <Bot className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">AI SYSTEM</span>
                  </>
                )}
              </span>
              {m.intent && (
                <span className="px-1.5 py-0.2 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 text-[9px]">
                  {m.intent}
                </span>
              )}
            </div>
            <div className="leading-relaxed">{m.text}</div>
          </div>
        ))}
      </div>

      {/* Quick Suggestion Chips */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {quickPrompts.map((prompt, i) => (
          <button
            key={i}
            onClick={() => handleExecuteCommand(prompt)}
            disabled={isProcessing}
            className="px-2 py-1 rounded text-[10px] bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all text-left"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Command Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleExecuteCommand(input);
        }}
        className="flex gap-2 pt-1 border-t border-zinc-800/60"
      >
        <input
          type="text"
          placeholder="Ask vision system or issue command (e.g. Find Alex)..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isProcessing}
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 font-mono"
        />
        <button
          type="submit"
          disabled={isProcessing || !input.trim()}
          className="px-3.5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black font-bold text-xs transition-all shadow-[0_0_10px_rgba(6,182,212,0.3)] flex items-center gap-1.5"
        >
          {isProcessing ? (
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">Send</span>
        </button>
      </form>
    </div>
  );
};
