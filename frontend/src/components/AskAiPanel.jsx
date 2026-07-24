import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Edit3, MessageSquare, Mic, MicOff, Plus, Search, Send, Sparkles, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { loadSchoolAnnouncements } from '../lib/school-announcements.js';
import './ask-ai.css';

const roleSuggestedPrompts = {
  teacher: [
    "Which students need extra help?",
    "Summarize today's submissions.",
    "Which topic did most students struggle with?",
    "Generate 10 MCQs on Photosynthesis.",
    "Show homework pending.",
    "Which students have low attendance?",
    "Summarize today's messages.",
    "Create a revision plan for Grade 10.",
    "Generate a worksheet.",
    "Summarize this class."
  ],
  student: [
    "Summarize my homework.",
    "What should I revise today?",
    "Show my weak topics.",
    "Explain Photosynthesis simply.",
    "Quiz me on Cell Division.",
    "Summarize today's teacher feedback.",
    "What assignments are due?",
    "Create a study schedule."
  ],
  admin: [
    "School performance summary",
    "Attendance report",
    "Teacher workload summary",
    "Top performing classes",
    "Pending assessments",
    "Recent announcements"
  ]
};

const nowISO = () => new Date().toISOString();

const createMessage = (role, content, extra = {}) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  role,
  content,
  createdAt: nowISO(),
  ...extra
});

/**
 * Rich Markdown Text Renderer Component
 * Renders headings, bold text, italics, inline code, and bullet lists cleanly as HTML elements.
 */
function FormattedMarkdownText({ content }) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements = [];
  let listItems = [];

  const renderFormattedInline = (text) => {
    const parts = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
      const codeMatch = remaining.match(/`(.*?)`/);
      const italicMatch = remaining.match(/\*(.*?)\*/);

      let firstMatch = null;
      let matchType = null;

      if (boldMatch && (!firstMatch || boldMatch.index < firstMatch.index)) {
        firstMatch = boldMatch;
        matchType = 'bold';
      }
      if (codeMatch && (!firstMatch || codeMatch.index < firstMatch.index)) {
        firstMatch = codeMatch;
        matchType = 'code';
      }
      if (italicMatch && (!firstMatch || italicMatch.index < firstMatch.index)) {
        firstMatch = italicMatch;
        matchType = 'italic';
      }

      if (!firstMatch) {
        parts.push(remaining);
        break;
      }

      if (firstMatch.index > 0) {
        parts.push(remaining.substring(0, firstMatch.index));
      }

      if (matchType === 'bold') {
        parts.push(<strong key={key++}>{firstMatch[1]}</strong>);
      } else if (matchType === 'code') {
        parts.push(<code key={key++} className="ask-ai-code-inline">{firstMatch[1]}</code>);
      } else if (matchType === 'italic') {
        parts.push(<em key={key++}>{firstMatch[1]}</em>);
      }

      remaining = remaining.substring(firstMatch.index + firstMatch[0].length);
    }

    return parts;
  };

  const flushList = (keyPrefix) => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`${keyPrefix}-ul`} className="ask-ai-md-list">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderFormattedInline(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList(index);
      elements.push(<div key={index} className="ask-ai-md-spacer" />);
      return;
    }

    if (trimmed.startsWith('### ')) {
      flushList(index);
      elements.push(<h3 key={index} className="ask-ai-md-h3">{renderFormattedInline(trimmed.slice(4))}</h3>);
      return;
    }
    if (trimmed.startsWith('#### ')) {
      flushList(index);
      elements.push(<h4 key={index} className="ask-ai-md-h4">{renderFormattedInline(trimmed.slice(5))}</h4>);
      return;
    }
    if (trimmed.startsWith('## ')) {
      flushList(index);
      elements.push(<h3 key={index} className="ask-ai-md-h3">{renderFormattedInline(trimmed.slice(3))}</h3>);
      return;
    }

    if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || /^\d+\.\s/.test(trimmed)) {
      const contentText = trimmed.replace(/^([•\-]\s*|\d+\.\s*)/, '');
      listItems.push(contentText);
      return;
    }

    flushList(index);
    elements.push(<p key={index} className="ask-ai-md-p">{renderFormattedInline(trimmed)}</p>);
  });

  flushList('final');

  return <div className="ask-ai-markdown-body">{elements}</div>;
}

function getInitialGreeting(role, page, currentClass) {
  const scope = currentClass ? `${currentClass.name} (${currentClass.subject})` : `${page} workspace`;
  if (role === 'teacher') {
    return createMessage('assistant', `Hello! I'm your TeachMate AI assistant for **${scope}**. I use only the classroom data your account is permitted to view. Ask about students, homework, attendance, quizzes, or ask me to prepare a reviewable worksheet or revision plan.`, { provider: 'TeachMate AI' });
  }
  if (role === 'student') {
    return createMessage('assistant', `Hi there! I'm your AI learning assistant for **${scope}**. Ask me any question about your homework, upcoming tests, school announcements, teacher feedback, weak topics, or ask me to generate a personalized study schedule!`, { provider: 'TeachMate AI' });
  }
  return createMessage('assistant', `Welcome! As your School Administrator AI, I have overall real-time context on school performance, teacher workloads, attendance reports, and announcements. How can I help you manage your school today?`, { provider: 'TeachMate AI' });
}




/**
 * Real-Data Workspace Analysis Engine
 * Uses ONLY live workspace data — no hardcoded fakes.
 * Returns null for anything that cannot be answered from real data → triggers LLM streaming.
 */
function analyzeWorkspaceAndReply(query, role, workspace, currentClass, page) {
  const text = query.trim();
  const q = text.toLowerCase();

  // Pull real data only
  const schoolName = workspace?.profile?.schoolName || workspace?.adminData?.school?.name || '';
  const students = workspace?.students || workspace?.adminData?.students || [];
  const classes = workspace?.classes || [];
  const homework = workspace?.homework || [];
  const quizzes = workspace?.quizzes || [];
  const tests = workspace?.tests || workspace?.assessments || [];
  const feedback = workspace?.feedback || workspace?.voiceFeedback || [];
  const resourcesList = workspace?.resources || currentClass?.resources || [];
  const adminData = workspace?.adminData || {};
  const activeClass = currentClass || classes[0] || null;
  const className = activeClass
    ? `${activeClass.name}${activeClass.subject ? ` (${activeClass.subject})` : ''}`
    : (schoolName || 'your workspace');

  // --- 1. SPECIFIC STUDENT LOOKUP BY NAME (real data only) ---
  const matchedStudent = students.find(s => s.name && q.includes(s.name.toLowerCase()));
  if (matchedStudent) {
    const studentHw = homework.filter(h =>
      h.submissions?.some(sub =>
        sub.studentId === matchedStudent.id ||
        sub.studentName?.toLowerCase() === matchedStudent.name.toLowerCase()
      )
    );
    const studentFb = feedback.filter(f =>
      f.studentId === matchedStudent.id ||
      f.studentName?.toLowerCase() === matchedStudent.name.toLowerCase()
    );
    const lines = [
      `**Student Record: ${matchedStudent.name}**`,
      `• **Class**: ${matchedStudent.className || activeClass?.name || 'Enrolled'}`,
      matchedStudent.score != null ? `• **Score**: ${matchedStudent.score}%` : null,
      matchedStudent.attendance != null ? `• **Attendance**: ${matchedStudent.attendance}%` : null,
      `• **Homework Submissions**: ${studentHw.length}`,
      studentFb.length > 0
        ? `• **Feedback**: ${studentFb.map(f => `"${f.summary || f.title || f.text}"`).join(', ')}`
        : null
    ].filter(Boolean);
    return lines.join('\n');
  }

  // --- 2. SPECIFIC CLASS LOOKUP BY NAME/SUBJECT (real data only) ---
  const matchedClass = classes.find(c =>
    (c.name && q.includes(c.name.toLowerCase())) ||
    (c.subject && q.includes(c.subject.toLowerCase()))
  );
  if (matchedClass && (q.includes('summary') || q.includes('how is') || q.includes('class') || q.includes('performance') || q.includes('report') || q.includes('overview'))) {
    const classStudents = students.filter(s =>
      s.classId === matchedClass.id ||
      s.className?.toLowerCase().includes(matchedClass.name?.split(' ')[0]?.toLowerCase())
    );
    const classHw = homework.filter(h =>
      h.classId === matchedClass.id ||
      h.className?.toLowerCase().includes(matchedClass.name?.split(' ')[0]?.toLowerCase()) ||
      h.subject?.toLowerCase() === matchedClass.subject?.toLowerCase()
    );
    const lines = [
      `**${matchedClass.name}${matchedClass.subject ? ` (${matchedClass.subject})` : ''} Overview**`,
      `• **Enrolled Students**: ${classStudents.length || matchedClass.students || 0}`,
      matchedClass.joinCode ? `• **Join Code**: \`${matchedClass.joinCode}\`` : null,
      `• **Assignments**: ${classHw.length}`,
      classStudents.length > 0
        ? `**Students**:\n` + classStudents.slice(0, 8).map(s =>
            `• ${s.name}${s.score != null ? ` — ${s.score}%` : ''}${s.attendance != null ? `, Attendance: ${s.attendance}%` : ''}`
          ).join('\n')
        : null
    ].filter(Boolean);
    return lines.join('\n');
  }

  // --- 3. WEAK / LOW-PERFORMING STUDENTS (real data only) ---
  if (q.includes('extra help') || q.includes('struggling') || q.includes('weak student') || q.includes('low attendance') || q.includes('who needs help')) {
    const weak = students.filter(s => (s.score != null && s.score < 75) || (s.attendance != null && s.attendance < 85));
    if (students.length === 0) return null; // No data yet, let LLM handle
    if (weak.length > 0) {
      const list = weak.map(s =>
        `• **${s.name}**${s.className ? ` (${s.className})` : ''}${s.score != null ? ` — Score: ${s.score}%` : ''}${s.attendance != null ? `, Attendance: ${s.attendance}%` : ''}`
      ).join('\n');
      return `**Students needing support in ${className}:**\n\n${list}\n\n**Action**: Schedule 1-on-1 check-ins or assign targeted practice.`;
    }
    return `All **${students.length}** students in **${className}** are currently meeting performance thresholds.`;
  }

  // --- 4. HOMEWORK / ASSIGNMENT LISTING (real data only) ---
  if (
    q.includes('what homework') || q.includes('which homework') || q.includes('homework i give') ||
    q.includes('homework i assigned') || q.includes('did i give') || q.includes('did i assign') ||
    q.includes('list homework') || q.includes('list assignment') || q.includes('my homework')
  ) {
    if (homework.length === 0) return null; // Let LLM answer
    const totalEnrolled = students.length || (activeClass?.students ? Number(activeClass.students) : 0);
    const list = homework.map(h => {
      const submitted = h.submissions
        ? h.submissions.filter(s => s.status === 'submitted' || s.status === 'graded' || s.submittedAt).length
        : 0;
      return `• **${h.title || h.name || h.subject}**${h.subject ? ` (${h.subject})` : ''}\n  Due: **${h.dueDate || h.due || 'Scheduled'}** | Status: *${h.status || 'Active'}* | Submissions: ${submitted}${totalEnrolled > 0 ? ` of ${totalEnrolled}` : ''}`;
    }).join('\n\n');
    return `**Assigned Homework for ${className}** (${homework.length} item${homework.length === 1 ? '' : 's'}):\n\n${list}`;
  }

  // --- 5. HOMEWORK COMPLETION / SUBMISSION REPORT (real data only) ---
  if (
    (q.includes('submission') || q.includes('completion') || q.includes('who submitted') || q.includes('submitted')) &&
    (q.includes('homework') || q.includes('assignment'))
  ) {
    if (homework.length === 0) return null;
    const totalEnrolled = students.length || (activeClass?.students ? Number(activeClass.students) : 0);
    const breakdown = homework.map(h => {
      const submitted = h.submissions
        ? h.submissions.filter(s => s.status === 'submitted' || s.status === 'graded' || s.submittedAt).length
        : 0;
      const pct = totalEnrolled > 0 ? Math.round((submitted / totalEnrolled) * 100) : 0;
      return `• **${h.title || h.subject}**: ${submitted}${totalEnrolled > 0 ? ` of ${totalEnrolled}` : ''} submitted${totalEnrolled > 0 ? ` (${pct}%)` : ''}`;
    }).join('\n');
    return `**Homework Submission Report for ${className}:**\n\n${breakdown}`;
  }

  // --- 6. QUIZ COMPLETION (real data only) ---
  if (
    (q.includes('completed') || q.includes('finished') || q.includes('done') || q.includes('submitted')) &&
    (q.includes('quiz') || q.includes('quizzes'))
  ) {
    if (quizzes.length === 0) return null;
    const lines = quizzes.map(qz => {
      const completedSubs = (qz.submissions || []).filter(s => s.submittedAt || s.status === 'completed');
      const names = completedSubs.map(s => s.studentName || s.studentId).filter(Boolean);
      return `• **${qz.title || qz.topic || 'Quiz'}**: ${completedSubs.length} student${completedSubs.length === 1 ? '' : 's'} completed${names.length > 0 ? ` (${names.join(', ')})` : ''}`;
    }).join('\n');
    return `**Quiz Completion for ${className}:**\n\n${lines}`;
  }

  // --- 7. RESOURCES / MATERIALS (real data only) ---
  if (q.includes('resource') || q.includes('material') || q.includes('upload') || q.includes('published file') || q.includes('study material')) {
    if (resourcesList.length > 0) {
      const items = resourcesList.map(r => `• **${r.title || r.name}** (${r.type || 'Document'})`).join('\n');
      return `**Study Resources for ${className}** (${resourcesList.length} file${resourcesList.length === 1 ? '' : 's'}):\n\n${items}\n\nStudents can download these from their Resources tab.`;
    }
    return `No study resources have been published for **${className}** yet. Upload slides, PDFs or worksheets from the Resources section.`;
  }

  // --- 8. ANNOUNCEMENTS (real data) ---
  if (q.includes('announcement') || q.includes('notice') || q.includes('school news')) {
    const schoolAnnouncements = loadSchoolAnnouncements(schoolName);
    const adminNotices = adminData.notifications || [];
    const allNotices = [...schoolAnnouncements, ...adminNotices];
    if (allNotices.length > 0) {
      const list = allNotices.map(n => `• **${n.title}**: ${n.body || n.text || ''}`).join('\n');
      return `**Active Announcements for ${schoolName || 'your school'}** (${allNotices.length}):\n\n${list}`;
    }
    return `No active announcements right now for ${schoolName || 'your school'}.`;
  }

  // --- 9. SCHOOL ADMIN OVERVIEW (real data only) ---
  if (role === 'admin' || role === 'school_admin') {
    const teacherList = adminData.teachers || [];
    const studentList = adminData.students || students;
    const classList = adminData.classes || classes;
    if (teacherList.length > 0 || studentList.length > 0 || classList.length > 0) {
      return `**School Overview for ${schoolName || 'your school'}:**\n\n` +
        `• **Active Teachers**: ${teacherList.length}\n` +
        `• **Enrolled Students**: ${studentList.length}\n` +
        `• **Active Classes**: ${classList.length}`;
    }
  }

  // --- 10. FEEDBACK SUMMARY (real data) ---
  if (q.includes('feedback') || q.includes('correction') || q.includes('observation')) {
    if (feedback.length > 0) {
      const items = feedback.slice(0, 5).map(f => `• **${f.title || 'Feedback'}** for ${f.studentName || 'student'}: ${f.summary || f.text || f.transcript || ''}`).join('\n');
      return `**Teacher Feedback (${feedback.length} note${feedback.length === 1 ? '' : 's'}) for ${className}:**\n\n${items}`;
    }
    return `No feedback notes recorded yet for **${className}**.`;
  }

  // --- Everything else → send to LLM ---
  return null;
}

async function streamAssistantReply({ token, payload, onEvent }) {
  const response = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/ai/assistant/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Ask AI service is temporarily unavailable.');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Streaming response is not supported in this browser.');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';

    for (const frame of frames) {
      const eventMatch = frame.match(/^event: (.+)$/m);
      const dataMatch = frame.match(/^data: (.+)$/m);
      if (eventMatch && dataMatch) {
        try {
          const event = eventMatch[1].trim();
          const data = JSON.parse(dataMatch[1].trim());
          onEvent(event, data);
        } catch {
          // ignore malformed SSE frames
        }
      }
    }
  }
}

/**
 * Builds a real-time data context summary for the LLM fallback.
 * Uses actual workspace data only — no fake numbers.
 */
function buildWorkspaceDataSummary(query, role, workspace, currentClass, page) {
  const students = workspace?.students || workspace?.adminData?.students || [];
  const homework = workspace?.homework || [];
  const quizzes = workspace?.quizzes || [];
  const tests = workspace?.tests || workspace?.assessments || [];
  const feedback = workspace?.feedback || workspace?.voiceFeedback || [];
  const resources = workspace?.resources || [];
  const activeClass = currentClass || workspace?.classes?.[0] || null;
  const className = activeClass
    ? `${activeClass.name}${activeClass.subject ? ` (${activeClass.subject})` : ''}`
    : 'your workspace';

  const totalSubmissions = [
    ...homework.flatMap(h => h.submissions || []),
    ...quizzes.flatMap(q => q.submissions || []),
    ...tests.flatMap(t => t.submissions || [])
  ].length;

  const pendingHw = homework.filter(h => h.status !== 'Completed' && h.status !== 'archived').length;

  return `**Live Workspace Data — ${className} (${page})**\n\n` +
    `• **Students Enrolled**: ${students.length}\n` +
    `• **Homework Assigned**: ${homework.length} (${pendingHw} active)\n` +
    `• **Practice Quizzes**: ${quizzes.length}\n` +
    `• **Formal Assessments**: ${tests.length}\n` +
    `• **Feedback Notes**: ${feedback.length}\n` +
    `• **Study Resources**: ${resources.length}\n` +
    `• **Total Submissions**: ${totalSubmissions}\n\n` +
    `I analyzed your live dashboard data above. For more detailed insights, please connect your school account so I can access the full database.`;
}

export default function AskAiPanel({ open, onClose, role, workspace, page, activeClass, authToken, configured }) {
  const userProfile = workspace?.profile || {};
  const userIdentifier = userProfile.id || userProfile.email || 'guest';
  const storageKey = `teachmate:ask-ai:threads:${userIdentifier}`;

  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [typing, setTyping] = useState(false);
  const [notice, setNotice] = useState('');
  const [interactionMode, setInteractionMode] = useState('voice');
  const [voiceStatus, setVoiceStatus] = useState('idle');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceReply, setVoiceReply] = useState(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const endRef = useRef(null);
  const recognitionRef = useRef(null);

  const currentClass = activeClass || workspace?.classes?.[0] || null;
  const activeThread = useMemo(() => threads.find(t => t.id === activeId) || null, [threads, activeId]);
  const speechRecognitionSupported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  // Load chat threads from local storage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (Array.isArray(saved) && saved.length > 0) {
        setThreads(saved);
        setActiveId(saved[0].id);
        return;
      }
    } catch {
      // fallback to new thread creation
    }

    const defaultThread = {
      id: `chat-${Date.now()}`,
      title: 'New conversation',
      createdAt: nowISO(),
      messages: [getInitialGreeting(role, page, currentClass)]
    };
    setThreads([defaultThread]);
    setActiveId(defaultThread.id);
  }, [storageKey]);

  // Sync threads to local storage
  useEffect(() => {
    if (threads.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(threads));
    }
  }, [threads, storageKey]);

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, activeThread?.messages?.length, typing]);

  useEffect(() => {
    if (open) {
      setInteractionMode('voice');
      setVoiceStatus('idle');
      setVoiceTranscript('');
      return undefined;
    }

    if (recognitionRef.current) {
      recognitionRef.current.cancelled = true;
      recognitionRef.current.abort?.();
    }
    recognitionRef.current = null;
    window.speechSynthesis?.cancel?.();
    return undefined;
  }, [open]);

  useEffect(() => () => {
    if (recognitionRef.current) {
      recognitionRef.current.cancelled = true;
      recognitionRef.current.abort?.();
    }
    window.speechSynthesis?.cancel?.();
  }, []);

  const createNewChat = () => {
    const newThread = {
      id: `chat-${Date.now()}`,
      title: 'New conversation',
      createdAt: nowISO(),
      messages: [getInitialGreeting(role, page, currentClass)]
    };
    setThreads(prev => [newThread, ...prev]);
    setActiveId(newThread.id);
    setInput('');
  };

  const updateActiveThread = (updater) => {
    setThreads(prev => prev.map(t => (t.id === activeId ? updater(t) : t)));
  };

  const removeThread = (id) => {
    setThreads(prev => {
      const next = prev.filter(t => t.id !== id);
      if (id === activeId) {
        setActiveId(next[0]?.id || null);
      }
      return next;
    });
  };

  const renameThread = (thread) => {
    const title = window.prompt('Rename conversation:', thread.title);
    if (title && title.trim()) {
      const cleanTitle = title.trim().slice(0, 80);
      setThreads(prev => prev.map(t => (t.id === thread.id ? { ...t, title: cleanTitle } : t)));
    }
  };

  const clearActiveChat = () => {
    if (!activeId) return;
    updateActiveThread(t => ({
      ...t,
      messages: [getInitialGreeting(role, page, currentClass)]
    }));
  };

  const dashboardQuestion = role === 'teacher'
    ? 'Give me a concise, evidence-based summary of my current dashboard. Include class activity, submitted work, attendance and records that still need attention. Do not estimate missing data.'
    : role === 'student'
      ? 'Give me a concise, evidence-based summary of what I should focus on from my current dashboard today. Do not estimate missing data.'
      : 'Give me a concise, evidence-based summary of the current school dashboard. Do not estimate missing data.';

  const speakResponse = (content) => {
    if (!autoSpeak || typeof window === 'undefined' || !window.speechSynthesis || !content) return;
    const spokenText = content
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#*_`]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000);
    if (!spokenText) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.rate = 1;
    utterance.onstart = () => setVoiceStatus('speaking');
    utterance.onend = () => setVoiceStatus('idle');
    utterance.onerror = () => setVoiceStatus('idle');
    window.speechSynthesis.speak(utterance);
  };

  const startVoiceQuestion = () => {
    if (typing) return;

    // Immediately interrupt AI speech synthesis if currently reading an answer aloud
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (voiceStatus === 'speaking') {
      setVoiceStatus('idle');
    }

    if (!speechRecognitionSupported) {
      setVoiceStatus('unsupported');
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.cancelled = true;
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setVoiceStatus('idle');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    let finalTranscript = '';
    let failed = false;

    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setVoiceTranscript('');
      setVoiceStatus('listening');
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(result => result[0]?.transcript || '')
        .join(' ')
        .trim();
      setVoiceTranscript(transcript);
      if (Array.from(event.results).some(result => result.isFinal)) finalTranscript = transcript;
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      failed = true;
      setVoiceStatus(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'permission' : 'error');
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (recognition.cancelled || failed) return;
      if (!finalTranscript) {
        setVoiceStatus('idle');
        return;
      }
      setVoiceStatus('processing');
      void sendMessage(finalTranscript, { source: 'voice', speak: true });
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setVoiceStatus('error');
    }
  };

  async function sendMessage(textToSend = input, { source = 'chat', speak = false } = {}) {
    const cleanText = textToSend.trim();
    if (!cleanText || typing) return;

    let targetThreadId = activeId;
    if (!targetThreadId) {
      const newThread = {
        id: `chat-${Date.now()}`,
        title: cleanText.slice(0, 40),
        createdAt: nowISO(),
        messages: [getInitialGreeting(role, page, currentClass)]
      };
      setThreads([newThread]);
      setActiveId(newThread.id);
      targetThreadId = newThread.id;
    }

    const userMsg = createMessage('user', cleanText, { source });
    const assistantMsgId = `${Date.now()}-assistant`;

    // Append user message & empty assistant placeholder
    updateActiveThread(thread => ({
      ...thread,
      title: thread.title === 'New conversation' ? cleanText.slice(0, 42) : thread.title,
      messages: [
        ...thread.messages,
        userMsg,
        {
          id: assistantMsgId,
          role: 'assistant',
          content: '',
          provider: null,
          createdAt: nowISO()
        }
      ]
    }));

    setInput('');
    setTyping(true);
    setNotice('');
    if (source === 'voice') {
      setVoiceStatus('processing');
      setVoiceTranscript(cleanText);
      setVoiceReply(null);
    }

    let replyText = '';
    let providerName = 'Ask AI';
    let requestFailed = false;

    const updateAssistantMsg = (patch) => {
      setThreads(items =>
        items.map(t =>
          t.id !== targetThreadId
            ? t
            : {
                ...t,
                messages: t.messages.map(m => (m.id === assistantMsgId ? { ...m, ...patch } : m))
              }
        )
      );
    };

    const appendAssistantText = (chunk) => {
      replyText += chunk;
      setThreads(items =>
        items.map(t =>
          t.id !== targetThreadId
            ? t
            : {
                ...t,
                messages: t.messages.map(m =>
                  m.id === assistantMsgId ? { ...m, content: (m.content || '') + chunk } : m
                )
              }
        )
      );
    };

    try {
      // 1. Evaluate Workspace Database Engine FIRST for instant, accurate, real-time answers & custom Q&As
      const localResponse = analyzeWorkspaceAndReply(cleanText, role, workspace, currentClass, page);

      if (localResponse) {
        replyText = localResponse;
        providerName = 'TeachMate AI';
        updateAssistantMsg({
          content: localResponse,
          provider: providerName,
          error: false
        });
        setVoiceReply({ content: localResponse, provider: providerName });
        speakResponse(localResponse);
        return;
      }

      // 2. If no local match, stream from server API if configured
      if (authToken && configured) {
        await streamAssistantReply({
          token: authToken,
          payload: {
            message: cleanText,
            page,
            classContext: currentClass
              ? { name: currentClass.name || '', subject: currentClass.subject || '', grade: currentClass.grade || '' }
              : null,
            workspaceContext: workspace || null,
            history: (activeThread?.messages || [])
              .slice(-10)
              .map(m => ({ role: m.role, content: m.content }))
          },
          onEvent: (event, data) => {
            if (event === 'delta' && data.text) appendAssistantText(data.text);
            if (event === 'provider' && data.provider) {
              providerName = data.provider;
              updateAssistantMsg({ provider: data.provider });
            }
            if (event === 'fallback' && data.message) setNotice(data.message);
            if (event === 'error') {
              requestFailed = true;
            }
          }
        });

        if (!requestFailed && replyText) {
          setVoiceReply({ content: replyText, provider: providerName });
          speakResponse(replyText);
          return;
        }
      }

      // 3. Fallback response with live dynamic database metrics
      const fallbackReply = buildWorkspaceDataSummary(cleanText, role, workspace, currentClass, page);
      replyText = fallbackReply;
      providerName = 'TeachMate AI';
      updateAssistantMsg({
        content: fallbackReply,
        provider: providerName,
        error: false
      });
      setVoiceReply({ content: fallbackReply, provider: providerName });
      speakResponse(fallbackReply);
    } catch (err) {
      const localFallback = buildWorkspaceDataSummary(cleanText, role, workspace, currentClass, page);
      replyText = localFallback;
      providerName = 'TeachMate AI';
      updateAssistantMsg({
        content: localFallback,
        provider: providerName,
        error: false
      });
      setVoiceReply({ content: localFallback, provider: providerName });
      speakResponse(localFallback);
    } finally {
      setTyping(false);
      if (source === 'voice') setVoiceStatus('idle');
    }
  }

  const filteredThreads = useMemo(() => {
    if (!search.trim()) return threads;
    const lower = search.toLowerCase();
    return threads.filter(
      t =>
        t.title.toLowerCase().includes(lower) ||
        t.messages.some(m => m.content.toLowerCase().includes(lower))
    );
  }, [threads, search]);

  const currentPrompts = roleSuggestedPrompts[role] || roleSuggestedPrompts.teacher;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            className="ask-ai-scrim"
            aria-label="Close Ask AI"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.div
            className="ask-ai-voice-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className={`ask-ai-voice-modal-container ${interactionMode === 'chat' ? 'mode-chat-modal' : ''}`}
              initial={{ opacity: 0, scale: 0.94, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 20 }}
              transition={{ type: 'spring', damping: 26, stiffness: 290 }}
              aria-label="Ask AI Workspace Assistant Big Screen"
            >
              {/* Central Modal Header */}
              <header className="ask-ai-voice-modal-header">
                <div className="ask-ai-voice-header-info">
                  <span className="ask-ai-voice-kicker">
                    <Sparkles size={14} /> DASHBOARD-AWARE AI ASSISTANT
                  </span>
                  <h2>{interactionMode === 'voice' ? 'Ask Your Workspace' : 'Your Workspace AI'}</h2>
                  <p className="ask-ai-voice-scope">
                    {currentClass
                      ? `${currentClass.name} · ${currentClass.subject}`
                      : `${page.toUpperCase()} · ${role.toUpperCase()} PORTAL`}
                  </p>
                </div>
                <div className="ask-ai-header-actions">
                  <div className="ask-ai-mode-toggle" role="tablist">
                    <button
                      type="button"
                      className={interactionMode === 'voice' ? 'active' : ''}
                      onClick={() => setInteractionMode('voice')}
                    >
                      <Mic size={13} /> Voice
                    </button>
                    <button
                      type="button"
                      className={interactionMode === 'chat' ? 'active' : ''}
                      onClick={() => setInteractionMode('chat')}
                    >
                      <MessageSquare size={13} /> Chat
                    </button>
                  </div>
                  <button className="ask-ai-voice-close-btn" onClick={onClose} aria-label="Close Assistant">
                    <X size={22} />
                  </button>
                </div>
              </header>

              {/* Central Modal Body */}
              {interactionMode === 'voice' ? (
                <div className="ask-ai-voice-modal-body">
                  <p className="ask-ai-voice-hero-sub">
                    Every voice question automatically includes your current page, class, role, and authorized Supabase dashboard data.
                  </p>

                  {/* Central Speak Orb Button */}
                  <div className="ask-ai-voice-orb-container">
                    {(voiceStatus === 'listening' || voiceStatus === 'speaking' || voiceStatus === 'processing') && (
                      <div className={`ask-ai-voice-wave-ring ${voiceStatus}`} />
                    )}
                    <button
                      type="button"
                      className={`ask-ai-voice-orb-btn ${voiceStatus}`}
                      onClick={startVoiceQuestion}
                      disabled={typing || voiceStatus === 'processing'}
                      aria-label={voiceStatus === 'listening' ? 'Stop listening' : 'Tap to speak'}
                    >
                      <div className="orb-icon-circle">
                        {voiceStatus === 'listening' ? <MicOff size={46} /> : <Mic size={46} />}
                      </div>
                      <span className="orb-status-text">
                        {voiceStatus === 'listening' ? 'Listening… tap to stop' : voiceStatus === 'processing' ? 'Analyzing dashboard…' : voiceStatus === 'speaking' ? 'Speaking… tap to stop & ask' : 'Tap to speak'}
                      </span>
                    </button>
                  </div>

                  {/* Status Indicator */}
                  <p className={`ask-ai-voice-status-bar ${voiceStatus}`}>
                    {voiceStatus === 'listening' && 'Listening to your question… speak now.'}
                    {voiceStatus === 'processing' && 'Analyzing your authorized dashboard & Supabase records…'}
                    {voiceStatus === 'speaking' && 'Ask AI is reading the response aloud. Tap orb to interrupt.'}
                    {voiceStatus === 'unsupported' && 'Voice input is not supported in this browser. Switch to Chat.'}
                    {voiceStatus === 'permission' && 'Microphone access was blocked. Please check browser permissions.'}
                    {voiceStatus === 'error' && 'Could not hear speech clearly. Please try speaking again.'}
                  </p>

                  {/* Speech Transcript */}
                  {voiceTranscript && (
                    <div className="ask-ai-transcript-box">
                      <span className="transcript-label">You Said</span>
                      <p className="transcript-text">"{voiceTranscript}"</p>
                    </div>
                  )}

                  {/* Action Bar */}
                  <div className="ask-ai-voice-bar-actions">
                    <button type="button" className="voice-btn-primary" onClick={() => sendMessage(dashboardQuestion, { source: 'voice', speak: true })} disabled={typing}>
                      <Sparkles size={14} /> Analyze my dashboard
                    </button>
                    <button
                      type="button"
                      className={`voice-btn-secondary ${autoSpeak ? 'active' : ''}`}
                      onClick={() => {
                        if (autoSpeak) window.speechSynthesis?.cancel?.();
                        setAutoSpeak(value => !value);
                      }}
                    >
                      {autoSpeak ? <Volume2 size={14} /> : <VolumeX size={14} />}
                      {autoSpeak ? 'Voice answers on' : 'Voice answers off'}
                    </button>
                  </div>

                  {/* Voice AI Reply Box */}
                  {voiceReply && (
                    <article className="ask-ai-voice-reply-card">
                      <div className="voice-reply-header">
                        <div className="reply-title">
                          <span className="ask-ai-avatar"><Sparkles size={14} /></span>
                          <strong>Ask AI Response</strong>
                        </div>
                        {voiceReply.content && (
                          <button
                            type="button"
                            className="voice-replay-btn"
                            onClick={() => speakResponse(voiceReply.content)}
                          >
                            <Volume2 size={13} /> Replay
                          </button>
                        )}
                      </div>
                      <div className="voice-reply-content">
                        <FormattedMarkdownText content={voiceReply.content} />
                      </div>
                      <small className="ask-ai-provider-tag">{voiceReply.provider}{!voiceReply.error && <Check size={11} />}</small>
                    </article>
                  )}

                  {notice && <p className="ask-ai-notice">{notice}</p>}

                  {/* Quick Prompts */}
                  <section className="ask-ai-voice-prompts-section">
                    <span>OR TRY ONE OF THESE DASHBOARD QUESTIONS</span>
                    <div className="ask-ai-voice-prompt-pills">
                      {currentPrompts.slice(0, 4).map(prompt => (
                        <button key={prompt} type="button" onClick={() => sendMessage(prompt, { source: 'voice', speak: true })} disabled={typing}>
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              ) : (
                /* Central Body: Chat Mode inside Modal */
                <div className="ask-ai-chat-modal-body">
                  <div className="ask-ai-chat-layout">
                    {/* Chat Conversations Drawer */}
                    <div className="ask-ai-chat-sidebar">
                      <div className="ask-ai-tools">
                        <button onClick={createNewChat}>
                          <Plus size={13} /> New Chat
                        </button>
                        <button onClick={clearActiveChat} disabled={!activeThread}>
                          <Trash2 size={13} /> Clear
                        </button>
                      </div>

                      <label className="ask-ai-search">
                        <Search size={13} />
                        <input
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                          placeholder="Search history..."
                        />
                      </label>

                      <div className="ask-ai-history">
                        {filteredThreads.slice(0, 8).map(thread => (
                          <button
                            className={thread.id === activeId ? 'active' : ''}
                            key={thread.id}
                            onClick={() => setActiveId(thread.id)}
                          >
                            <MessageSquare size={13} />
                            <span>{thread.title}</span>
                            <i
                              onClick={e => {
                                e.stopPropagation();
                                renameThread(thread);
                              }}
                              title="Rename conversation"
                            >
                              <Edit3 size={11} />
                            </i>
                            <i
                              onClick={e => {
                                e.stopPropagation();
                                removeThread(thread.id);
                              }}
                              title="Delete conversation"
                            >
                              <Trash2 size={11} />
                            </i>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Chat Main Stream */}
                    <div className="ask-ai-chat-main">
                      <section className="ask-ai-conversation">
                        {activeThread?.messages.map(msg => (
                          <article className={`ask-ai-message ${msg.role}`} key={msg.id}>
                            {msg.role === 'assistant' && (
                              <span className="ask-ai-avatar">
                                <Sparkles size={13} />
                              </span>
                            )}
                            <div>
                              {msg.content ? (
                                <FormattedMarkdownText content={msg.content} />
                              ) : (
                                <span className="ask-ai-dots">
                                  <i />
                                  <i />
                                  <i />
                                </span>
                              )}
                              {msg.role === 'assistant' && msg.content && (
                                <small className="ask-ai-provider-tag">
                                  {msg.provider || 'Ask AI'}
                                  {msg.provider && !msg.error && <Check size={11} />}
                                </small>
                              )}
                            </div>
                          </article>
                        ))}

                        {typing && (
                          <div className="ask-ai-thinking">
                            <Sparkles size={14} />
                            <span>Analyzing workspace data...</span>
                          </div>
                        )}
                        <div ref={endRef} />
                      </section>

                      {notice && <p className="ask-ai-notice">{notice}</p>}

                      {/* Suggested Role Prompts */}
                      <section className="ask-ai-suggestions">
                        <span>Suggested for {role}</span>
                        <div className="ask-ai-suggestions-list">
                          {currentPrompts.slice(0, 3).map(prompt => (
                            <button key={prompt} onClick={() => sendMessage(prompt)}>
                              {prompt}
                            </button>
                          ))}
                        </div>
                      </section>

                      {/* Message Input Box */}
                      <form
                        className="ask-ai-composer"
                        onSubmit={e => {
                          e.preventDefault();
                          sendMessage();
                        }}
                      >
                        <input
                          value={input}
                          onChange={e => setInput(e.target.value)}
                          placeholder="Ask about students, homework, quizzes, reports..."
                          disabled={typing}
                        />
                        <button type="submit" disabled={!input.trim() || typing} aria-label="Send message">
                          <Send size={16} />
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              )}

              <footer className="ask-ai-voice-modal-footer">
                Private to your account · Context-aware AI workspace assistant
              </footer>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
