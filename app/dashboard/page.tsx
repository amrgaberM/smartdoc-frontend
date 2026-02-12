"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import api from "../../lib/api";
import { useRouter } from "next/navigation";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Source {
  document_id?: number;
  document_title?: string;
  page?: number;
  chunk?: number;
  text?: string;
  score?: number;
}

interface Message {
  role: "user" | "ai";
  content: string;
  timestamp: number;
  id: string;
  sources?: Source[];
  isGlobal?: boolean;
}

interface AnalysisResult {
  insights?: string;
  error?: string;
  summary?: string;
  word_count?: number;
  page_count?: number;
}

interface Document {
  id: number;
  title: string;
  status: "pending" | "processing" | "completed" | "failed";
  analysis_result?: AnalysisResult;
  created_at?: string;
  file_size?: number;
  updated_at?: string;
}

interface UploadProgress {
  percent: number;
  uploading: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const POLLING_INTERVAL = 4000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const API_TIMEOUT = 60000;
const ALLOWED_FILE_TYPE = "application/pdf";

const STATUS_CONFIG = {
  pending: { color: "yellow", label: "Pending" },
  processing: { color: "blue", label: "Processing" },
  completed: { color: "green", label: "Ready" },
  failed: { color: "red", label: "Failed" }
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return "Unknown size";
  const kb = bytes / 1024;
  const mb = kb / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
};

const formatTimestamp = (timestamp?: string): string => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
};

const generateMessageId = (): string => {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const getStatusStyle = (status: Document["status"]) => {
  const config = STATUS_CONFIG[status];
  return {
    dotColor: `bg-${config.color}-500`,
    textColor: `text-${config.color}-400`,
    borderColor: `border-${config.color}-500/30`,
    bgColor: `bg-${config.color}-500/10`
  };
};

const formatSources = (sources?: Source[]): string => {
  if (!sources || sources.length === 0) return "";
  const hasPages = sources.some(s => s.page !== undefined);
  if (hasPages) {
    const pageNumbers = sources
      .map(s => s.page)
      .filter((page): page is number => page !== undefined)
      .filter((page, index, self) => self.indexOf(page) === index)
      .sort((a, b) => a - b);
    if (pageNumbers.length === 0) return "";
    return `Page${pageNumbers.length > 1 ? 's' : ''} ${pageNumbers.join(", ")}`;
  }
  return `${sources.length} sources`;
};

// ============================================================================
// CUSTOM HOOKS
// ============================================================================

const useDocumentPolling = (fetchDocs: () => Promise<void>, documents: Document[]) => {
  useEffect(() => {
    const hasProcessingDocs = documents.some(d => d.status === "processing" || d.status === "pending");
    if (!hasProcessingDocs) return;
    const interval = setInterval(fetchDocs, POLLING_INTERVAL);
    return () => clearInterval(interval);
  }, [documents, fetchDocs]);
};

const useAutoScroll = (dependency: any[]) => {
  const elementRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    elementRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [dependency]);
  return elementRef;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function Dashboard() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [activeDoc, setActiveDoc] = useState<Document | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [globalMessages, setGlobalMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [globalInput, setGlobalInput] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({ percent: 0, uploading: false });
  const [error, setError] = useState<string | null>(null);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showClearHistoryModal, setShowClearHistoryModal] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useAutoScroll([messages]);
  const globalMessagesEndRef = useAutoScroll([globalMessages]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchDocs = useCallback(async () => {
    try {
      const response = await api.get("/documents/", { timeout: API_TIMEOUT });
      const data = response.data.results || response.data;
      setDocuments(data);
      setActiveDoc(prev => {
        if (!prev) return null;
        const updated = data.find((d: Document) => d.id === prev.id);
        return updated || prev;
      });
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setIsLoadingDocs(false);
    }
  }, []);

  useEffect(() => { fetchDocs(); }, []);
  useDocumentPolling(fetchDocs, documents);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadProgress({ percent: 0, uploading: true });
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", file.name);
    try {
      await api.post("/documents/", formData, {
        onUploadProgress: (p) => setUploadProgress({ percent: Math.round((p.loaded * 100) / (p.total || 1)), uploading: true })
      });
      fetchDocs();
    } catch (err) { setError("Upload failed"); }
    finally { setUploadProgress({ percent: 0, uploading: false }); }
  };

  const startAnalysis = async (doc: Document) => {
    try {
      await api.post(`/documents/${doc.id}/analyze/`);
      fetchDocs();
    } catch (err) { setError("Analysis failed"); }
  };

  const handleDelete = async (doc: Document) => {
    if (!confirm(`Delete ${doc.title}?`)) return;
    try {
      await api.delete(`/documents/${doc.id}/`);
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
      if (activeDoc?.id === doc.id) setActiveDoc(null);
    } catch (err) { setError("Delete failed"); }
  };

  const handleAsk = async (e: React.FormEvent, type: "global" | "specific" = "specific") => {
    e.preventDefault();
    const isGlobal = type === "global";
    const text = isGlobal ? globalInput : input;
    if (!text.trim()) return;

    const userMsg: Message = { role: "user", content: text, timestamp: Date.now(), id: generateMessageId(), isGlobal };
    if (isGlobal) {
      setGlobalMessages(prev => [...prev, userMsg]);
      setGlobalInput("");
    } else {
      setMessages(prev => [...prev, userMsg]);
      setInput("");
    }

    setIsAsking(true);
    try {
      const url = isGlobal ? "/documents/global_ask/" : `/documents/${activeDoc?.id}/ask/`;
      const res = await api.post(url, { question: text });
      const aiMsg: Message = {
        role: "ai",
        content: res.data.answer,
        timestamp: Date.now(),
        id: generateMessageId(),
        sources: res.data.sources,
        isGlobal
      };
      isGlobal ? setGlobalMessages(prev => [...prev, aiMsg]) : setMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      setError("AI failed to respond");
    } finally {
      setIsAsking(false);
    }
  };

  const handleLogout = () => { localStorage.clear(); router.push("/login"); };

  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => doc.title.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [documents, searchQuery]);

  return (
    <div className="flex h-screen bg-gray-950 text-white font-sans overflow-hidden">
      <div className={`flex-1 flex flex-col transition-all duration-500 ${activeDoc ? "mr-[500px]" : ""}`}>
        <header className="flex-shrink-0 px-8 py-6 border-b border-gray-800/50 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Smart<span className="text-blue-500">Doc</span></h1>
            <p className="text-xs text-gray-500 mt-1">Enterprise Document Intelligence</p>
          </div>
          <button onClick={handleLogout} className="px-4 py-2 border border-gray-800 rounded-lg hover:bg-gray-900 transition">Logout</button>
        </header>

        <main className="flex-1 overflow-y-auto px-8 py-6">
          <div className="max-w-7xl mx-auto space-y-6">
            
            {/* GLOBAL SEARCH SECTION */}
            {!activeDoc && (
              <div className="bg-gray-900/40 border border-blue-500/20 rounded-2xl flex flex-col h-[450px] shadow-2xl overflow-hidden">
                <div className="px-6 py-3 border-b border-blue-500/10 flex items-center justify-between">
                  <h2 className="text-xs font-bold text-blue-400 uppercase tracking-widest">Global Intelligence Search</h2>
                  <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20">All Documents</span>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {globalMessages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] p-4 rounded-2xl ${msg.role === 'user' ? 'bg-blue-600' : 'bg-gray-800/80 border border-gray-700'}`}>
                        <p className="text-sm">{msg.content}</p>
                        {msg.sources && (
                          <div className="mt-2 text-[10px] text-gray-500 border-t border-gray-700 pt-2">
                            Found in: {msg.sources.map(s => s.document_title).join(", ")}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={globalMessagesEndRef} />
                </div>
                <form onSubmit={(e) => handleAsk(e, "global")} className="p-4 bg-gray-950/30 border-t border-gray-800">
                  <div className="flex gap-2">
                    <input 
                      value={globalInput}
                      onChange={(e) => setGlobalInput(e.target.value)}
                      placeholder="Ask a question across all your documents..." 
                      className="flex-1 bg-gray-800 border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                    <button type="submit" disabled={isAsking} className="bg-blue-600 hover:bg-blue-500 px-6 rounded-xl font-bold transition">Ask All</button>
                  </div>
                </form>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* UPLOAD PANEL */}
              <div className="lg:col-span-1 bg-gray-900/30 p-6 rounded-2xl border border-gray-800/50">
                <h2 className="text-sm font-bold text-gray-400 mb-4 uppercase">Upload</h2>
                <div className="relative border-2 border-dashed border-gray-700 rounded-xl p-8 text-center hover:border-blue-500 transition cursor-pointer">
                  <input ref={fileInputRef} type="file" onChange={handleUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                  <p className="text-sm text-gray-500">Drop PDF or Click</p>
                  {uploadProgress.uploading && <div className="mt-2 text-blue-500 text-xs">Uploading {uploadProgress.percent}%</div>}
                </div>
              </div>

              {/* LIBRARY PANEL */}
              <div className="lg:col-span-2 bg-gray-900/30 p-6 rounded-2xl border border-gray-800/50">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-sm font-bold text-gray-400 uppercase">Library</h2>
                  <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Filter..." className="bg-gray-800 text-xs px-3 py-1.5 rounded-lg border border-gray-700 outline-none" />
                </div>
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                  {filteredDocuments.map(doc => (
                    <div key={doc.id} className={`p-4 rounded-xl border transition ${activeDoc?.id === doc.id ? 'bg-blue-500/10 border-blue-500/50' : 'bg-gray-800/30 border-gray-800/50 hover:bg-gray-800/50'}`}>
                      <div className="flex justify-between items-center">
                        <div>
                          <h3 className="text-sm font-semibold truncate w-48">{doc.title}</h3>
                          <span className={`text-[10px] font-bold uppercase ${getStatusStyle(doc.status).textColor}`}>{doc.status}</span>
                        </div>
                        <div className="flex gap-2">
                          {doc.status === "pending" && <button onClick={() => startAnalysis(doc)} className="bg-blue-600 text-[10px] px-3 py-1.5 rounded-lg font-bold">Analyze</button>}
                          {doc.status === "completed" && <button onClick={() => { setActiveDoc(doc); setMessages([]); }} className="bg-green-600 text-[10px] px-3 py-1.5 rounded-lg font-bold">Open</button>}
                          <button onClick={() => handleDelete(doc)} className="text-gray-600 hover:text-red-500 transition">Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* SIDEBAR CHAT (SPECIFIC DOC) */}
      {activeDoc && (
        <aside className="w-[500px] bg-gray-900 border-l border-gray-800 fixed right-0 h-full flex flex-col animate-in slide-in-from-right">
          <div className="p-6 border-b border-gray-800 flex justify-between items-center">
            <h3 className="font-bold truncate w-64">{activeDoc.title}</h3>
            <button onClick={() => setActiveDoc(null)} className="text-gray-500 hover:text-white">Close</button>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-4 rounded-xl ${msg.role === 'user' ? 'bg-blue-600' : 'bg-gray-800 border border-gray-700'}`}>
                  <p className="text-sm">{msg.content}</p>
                  {msg.sources && <p className="mt-2 text-[10px] text-blue-400 font-bold">{formatSources(msg.sources)}</p>}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={(e) => handleAsk(e, "specific")} className="p-6 border-t border-gray-800">
            <div className="flex gap-2">
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about this document..." className="flex-1 bg-gray-800 rounded-xl px-4 py-3 text-sm outline-none" />
              <button type="submit" disabled={isAsking} className="bg-blue-600 p-3 rounded-xl">Ask</button>
            </div>
          </form>
        </aside>
      )}
    </div>
  );
}