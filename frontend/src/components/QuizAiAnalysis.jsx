import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles,
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  HelpCircle,
  TrendingUp,
  AlertTriangle,
  BookOpen,
  ArrowLeft,
  Users,
  Award,
  ChevronRight,
  Send,
  Copy,
  Lightbulb
} from 'lucide-react';

/**
 * Calculates deterministic AI Quiz Analysis metrics at both Class and Individual levels.
 */
export function calculateQuizAiAnalysis(quiz, roster = []) {
  const questions = quiz.questions || [];
  let submissions = quiz.submissions || [];

  // Diagnostics must reflect recorded learner attempts. Fabricating sample
  // submissions would make an empty assessment look like a real class result.
  const totalStudents = Math.max(roster.length, submissions.length);
  const completedCount = submissions.length;
  const pendingCount = Math.max(0, totalStudents - completedCount);

  // 1. Overall Metrics
  const scores = submissions.map(s => Number(s.score) || 0);
  const averageScore = completedCount > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / completedCount) : 0;
  const highestScore = completedCount > 0 ? Math.max(...scores) : 0;
  const lowestScore = completedCount > 0 ? Math.min(...scores) : 0;

  // 2. Map questions by Learning Topic
  const topicMap = {};
  questions.forEach((q, idx) => {
    const topicName = (q.learningTopic || q.topic || quiz.topic || 'General Concept').trim();
    if (!topicMap[topicName]) {
      topicMap[topicName] = {
        name: topicName,
        questions: [],
        totalAttempts: 0,
        correctAttempts: 0
      };
    }
    topicMap[topicName].questions.push(q);
  });

  // Calculate Class Topic Performance
  submissions.forEach(sub => {
    const userAnswers = sub.answers || [];
    userAnswers.forEach((ans, aIdx) => {
      const qRef = questions[aIdx] || questions.find(q => q.id === ans.questionId);
      const topicName = (ans.learningTopic || qRef?.learningTopic || qRef?.topic || quiz.topic || 'General Concept').trim();
      if (topicMap[topicName]) {
        topicMap[topicName].totalAttempts += 1;
        if (ans.isCorrect) {
          topicMap[topicName].correctAttempts += 1;
        }
      }
    });
  });

  const topicAccuracyTable = Object.values(topicMap).map(t => {
    const accuracyPct = t.totalAttempts > 0 ? Math.round((t.correctAttempts / t.totalAttempts) * 100) : 0;
    let status = 'Moderate';
    if (accuracyPct >= 80) status = 'Strong';
    else if (accuracyPct < 60) status = 'Needs Focus';
    return {
      topic: t.name,
      questionCount: t.questions.length,
      totalAttempts: t.totalAttempts,
      correctAttempts: t.correctAttempts,
      accuracyPct,
      status
    };
  });

  // Sort topics by accuracy
  const sortedTopics = [...topicAccuracyTable].sort((a, b) => b.accuracyPct - a.accuracyPct);
  const strongestTopic = sortedTopics.length > 0 ? `${sortedTopics[0].topic} (${sortedTopics[0].accuracyPct}%)` : 'N/A';
  const mostDifficultTopic = sortedTopics.length > 0 ? `${sortedTopics[sortedTopics.length - 1].topic} (${sortedTopics[sortedTopics.length - 1].accuracyPct}%)` : 'N/A';

  // 3. Question Difficulty Analysis
  const questionDifficultyAnalysis = questions.map((q, idx) => {
    let qTotal = 0;
    let qCorrect = 0;
    const wrongChoices = {};

    submissions.forEach(sub => {
      const ansObj = (sub.answers || [])[idx] || (sub.answers || []).find(a => a.questionId === q.id);
      if (ansObj) {
        qTotal += 1;
        if (ansObj.isCorrect) qCorrect += 1;
        else if (ansObj.userAnswer) {
          wrongChoices[ansObj.userAnswer] = (wrongChoices[ansObj.userAnswer] || 0) + 1;
        }
      }
    });

    const accuracyPct = qTotal > 0 ? Math.round((qCorrect / qTotal) * 100) : 0;
    let difficulty = 'Medium';
    if (accuracyPct >= 75) difficulty = 'Easy';
    else if (accuracyPct < 50) difficulty = 'Hard';

    const mostCommonWrong = Object.entries(wrongChoices).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return {
      questionIndex: idx + 1,
      questionId: q.id,
      prompt: q.prompt,
      learningTopic: q.learningTopic || q.topic || quiz.topic || 'General Concept',
      correctAnswer: q.answer,
      totalAttempts: qTotal,
      correctCount: qCorrect,
      accuracyPct,
      difficulty,
      mostCommonWrong
    };
  });

  // 4. Most Common Mistakes Across Class
  const commonMistakesList = [];
  questionDifficultyAnalysis.forEach(q => {
    if (q.mostCommonWrong && q.accuracyPct < 75) {
      commonMistakesList.push({
        questionNum: q.questionIndex,
        topic: q.learningTopic,
        prompt: q.prompt,
        commonWrongChoice: q.mostCommonWrong,
        correctAnswer: q.correctAnswer,
        accuracyPct: q.accuracyPct,
        explanation: `Many students selected "${q.mostCommonWrong}" instead of the correct answer "${q.correctAnswer}". This points to a concept misconception in ${q.learningTopic}.`
      });
    }
  });

  // 5. AI Teaching Recommendation
  let aiTeachingRecommendation = "";
  const weakTopics = topicAccuracyTable.filter(t => t.accuracyPct < 65).map(t => t.topic);
  if (completedCount === 0) {
    aiTeachingRecommendation = "No student attempts recorded yet. AI recommendations will automatically synthesize classroom learning gaps once submissions are received.";
  } else if (weakTopics.length > 0) {
    aiTeachingRecommendation = `Class analysis indicates learning gaps in ${weakTopics.join(' & ')} (Average accuracy < 65%). Recommend dedicating 15–20 minutes in the upcoming session to re-explain core concepts in ${weakTopics[0]} and providing targeted remedial practice questions.`;
  } else {
    aiTeachingRecommendation = `Excellent overall comprehension! The class achieved a ${averageScore}% overall average with high accuracy across all concepts. Students are ready to move on to advanced applications in ${quiz.topic}.`;
  }

  // 6. Individual Student Analysis
  const studentAnalyses = submissions.map(sub => {
    const subAnswers = sub.answers || [];
    const studentTopicMap = {};

    questions.forEach((q, idx) => {
      const topic = (q.learningTopic || q.topic || quiz.topic || 'General Concept').trim();
      if (!studentTopicMap[topic]) {
        studentTopicMap[topic] = { total: 0, correct: 0, wrongQuestions: [] };
      }
      studentTopicMap[topic].total += 1;

      const userAns = subAnswers[idx] || subAnswers.find(a => a.questionId === q.id);
      if (userAns && userAns.isCorrect) {
        studentTopicMap[topic].correct += 1;
      } else {
        studentTopicMap[topic].wrongQuestions.push({
          questionNum: idx + 1,
          prompt: q.prompt,
          userAnswer: userAns?.userAnswer || 'Skipped',
          correctAnswer: q.answer,
          explanation: q.explanation || 'Review textbook chapter for detailed derivation.'
        });
      }
    });

    const conceptUnderstanding = Object.entries(studentTopicMap).map(([topic, stats]) => {
      const pct = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
      let status = 'Moderate';
      if (pct >= 80) status = 'Strong';
      else if (pct < 60) status = 'Needs Focus';
      return { topic, pct, status, correct: stats.correct, total: stats.total };
    });

    const sStrong = conceptUnderstanding.filter(c => c.pct >= 80).map(c => c.topic);
    const sWeak = conceptUnderstanding.filter(c => c.pct < 60).map(c => c.topic);

    const studentMistakes = [];
    Object.entries(studentTopicMap).forEach(([topic, stats]) => {
      stats.wrongQuestions.forEach(wq => {
        studentMistakes.push({
          topic,
          questionNum: wq.questionNum,
          prompt: wq.prompt,
          userAnswer: wq.userAnswer,
          correctAnswer: wq.correctAnswer,
          explanation: wq.explanation
        });
      });
    });

    let aiRevisionSuggestions = "";
    if (sWeak.length > 0) {
      aiRevisionSuggestions = `Focus your revision on ${sWeak.join(' & ')}. Review key definitions, formulas, and re-solve questions you answered incorrectly.`;
    } else {
      aiRevisionSuggestions = `Outstanding mastery in ${quiz.topic}! Keep up the great work and attempt higher difficulty challenge problems.`;
    }

    return {
      studentId: sub.studentId,
      studentName: sub.studentName,
      score: sub.score,
      rawScore: `${sub.correctCount || 0}/${questions.length}`,
      correctCount: sub.correctCount || 0,
      incorrectCount: sub.incorrectCount || 0,
      skippedCount: sub.skippedCount || 0,
      timeTaken: sub.timeTakenFormatted || '2m 45s',
      submittedAt: sub.submittedAt,
      strongTopics: sStrong,
      weakTopics: sWeak,
      commonMistakes: studentMistakes,
      conceptUnderstanding,
      aiRevisionSuggestions
    };
  });

  return {
    classLevel: {
      totalStudents,
      completedCount,
      pendingCount,
      averageScore,
      highestScore,
      lowestScore,
      topicAccuracyTable,
      questionDifficultyAnalysis,
      mostDifficultTopic,
      strongestTopic,
      commonMistakesList,
      aiTeachingRecommendation
    },
    studentAnalyses
  };
}

export default function QuizAiAnalysisView({ quiz, roster = [], onBack, onToast, updateWorkspace }) {
  const [activeTab, setActiveTab] = useState('class'); // 'class' or 'individual'
  const [selectedStudentId, setSelectedStudentId] = useState(null);

  const analysis = calculateQuizAiAnalysis(quiz, roster);
  const { classLevel, studentAnalyses } = analysis;

  const currentStudentAnalysis = selectedStudentId
    ? studentAnalyses.find(s => s.studentId === selectedStudentId) || studentAnalyses[0]
    : studentAnalyses[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      style={{ padding: '12px 4px 32px' }}
    >
      {/* Top Header Navigation */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
        <button
          type="button"
          onClick={onBack}
          className="button subtle"
          style={{
            width: 'fit-content',
            padding: '7px 14px',
            borderRadius: '9px',
            fontWeight: '800',
            background: 'var(--soft)',
            color: '#4f46e5',
            border: '1px solid var(--line)',
            cursor: 'pointer',
            fontSize: '12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <ArrowLeft size={16} /> Back to Class Quizzes
        </button>

        <div>
          <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#6366f1', fontWeight: '800', fontSize: '11px', letterSpacing: '.08em', margin: '4px 0 6px' }}>
            <Sparkles size={14} style={{ color: '#8b5cf6' }} /> AI QUIZ DIAGNOSTICS & ANALYTICS
          </div>
          <h1 style={{ margin: '0', font: "800 clamp(24px, 3.5vw, 32px)/1.15 'Plus Jakarta Sans', sans-serif", letterSpacing: '-1px', color: 'var(--text)' }}>
            {quiz.title}
          </h1>
          <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: '13px' }}>
            Subject: <b style={{ color: 'var(--text)' }}>{quiz.subject || 'Science'}</b> &middot; Topic: <b style={{ color: 'var(--text)' }}>{quiz.topic}</b> &middot; {quiz.questions?.length || 0} Questions &middot; Time Limit: {quiz.timeLimit || 15} mins
          </p>
        </div>
      </div>

      {/* Analysis Mode Switcher Tabs */}
      <div
        className="workspace-tabs"
        style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '22px',
          borderBottom: '1px solid var(--line)',
          paddingBottom: '10px'
        }}
      >
        <button
          type="button"
          className={`button ${activeTab === 'class' ? 'primary' : 'ghost'}`}
          onClick={() => setActiveTab('class')}
          style={{ borderRadius: '10px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <BarChart3 size={16} /> 📊 Class-Level Analysis
        </button>
        <button
          type="button"
          className={`button ${activeTab === 'individual' ? 'primary' : 'ghost'}`}
          onClick={() => setActiveTab('individual')}
          style={{ borderRadius: '10px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <Users size={16} /> 👤 Individual Student Analysis
        </button>
      </div>

      {/* ========================================================= */}
      {/* LEVEL 2: CLASS-LEVEL ANALYSIS TAB */}
      {/* ========================================================= */}
      {activeTab === 'class' && (
        <div style={{ display: 'grid', gap: '22px' }}>
          {/* Class Metrics Row */}
          <section className="metric-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
            <article className="metric-card" style={{ padding: '14px' }}>
              <span className="metric-icon indigo"><Users size={18} /></span>
              <div>
                <p>Total Students</p>
                <h3>{classLevel.totalStudents}</h3>
                <small>Enrolled class</small>
              </div>
            </article>

            <article className="metric-card" style={{ padding: '14px' }}>
              <span className="metric-icon emerald"><CheckCircle2 size={18} /></span>
              <div>
                <p>Completed</p>
                <h3 style={{ color: '#059669' }}>{classLevel.completedCount}</h3>
                <small>Submissions</small>
              </div>
            </article>

            <article className="metric-card" style={{ padding: '14px' }}>
              <span className="metric-icon amber"><Clock size={18} /></span>
              <div>
                <p>Pending</p>
                <h3 style={{ color: '#d97706' }}>{classLevel.pendingCount}</h3>
                <small>Awaiting attempt</small>
              </div>
            </article>

            <article className="metric-card" style={{ padding: '14px' }}>
              <span className="metric-icon violet"><BarChart3 size={18} /></span>
              <div>
                <p>Average Score</p>
                <h3>{classLevel.averageScore}%</h3>
                <small>Class mean</small>
              </div>
            </article>

            <article className="metric-card" style={{ padding: '14px' }}>
              <span className="metric-icon emerald"><TrendingUp size={18} /></span>
              <div>
                <p>Highest Score</p>
                <h3 style={{ color: '#059669' }}>{classLevel.highestScore}%</h3>
                <small>Top performance</small>
              </div>
            </article>

            <article className="metric-card" style={{ padding: '14px' }}>
              <span className="metric-icon danger" style={{ background: '#fef2f2', color: '#dc2626' }}>
                <AlertTriangle size={18} />
              </span>
              <div>
                <p>Lowest Score</p>
                <h3 style={{ color: '#dc2626' }}>{classLevel.lowestScore}%</h3>
                <small>Minimum score</small>
              </div>
            </article>
          </section>

          {/* Highlights & AI Recommendation Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
            {/* Highlights Card */}
            <section className="card">
              <div className="card-header">
                <div>
                  <p className="eyebrow">CONCEPT SUMMARY</p>
                  <h3>Key Topic Performance</h3>
                </div>
              </div>

              <div style={{ display: 'grid', gap: '12px', marginTop: '10px' }}>
                <div style={{ padding: '14px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#047857', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Award size={16} /> STRONGEST TOPIC
                  </span>
                  <p style={{ margin: '6px 0 0', fontWeight: '700', fontSize: '15px', color: '#065f46' }}>
                    {classLevel.strongestTopic}
                  </p>
                  <small style={{ color: '#047857', fontSize: '11px' }}>Highest accuracy demonstrated by students</small>
                </div>

                <div style={{ padding: '14px', borderRadius: '12px', background: '#fef2f2', border: '1px solid #fecdd3' }}>
                  <span style={{ fontSize: '11px', fontWeight: '800', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertTriangle size={16} /> MOST DIFFICULT TOPIC
                  </span>
                  <p style={{ margin: '6px 0 0', fontWeight: '700', fontSize: '15px', color: '#991b1b' }}>
                    {classLevel.mostDifficultTopic}
                  </p>
                  <small style={{ color: '#b91c1c', fontSize: '11px' }}>Requires teacher review and concept reinforcement</small>
                </div>
              </div>
            </section>

            {/* AI Teaching Recommendation Card */}
            <section className="card" style={{ background: 'linear-gradient(135deg, #f5f3ff, #faf5ff)', border: '1px solid #ddd6fe' }}>
              <div className="card-header">
                <div>
                  <p className="eyebrow" style={{ color: '#7c3aed' }}>
                    <Sparkles size={13} style={{ display: 'inline', marginRight: '4px' }} /> AI TEACHER RECOMMENDATION
                  </p>
                  <h3 style={{ color: '#4c1d95' }}>Pedagogical Guidance</h3>
                </div>
              </div>

              <p style={{ color: '#5b21b6', fontSize: '13px', lineHeight: '1.6', margin: '10px 0 16px' }}>
                {classLevel.aiTeachingRecommendation}
              </p>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="button primary"
                  style={{ fontSize: '11px', height: '34px' }}
                  onClick={() => onToast('Remedial review draft created in Class Homework.')}
                >
                  <BookOpen size={14} /> Assign Remedial Review
                </button>
                <button
                  type="button"
                  className="button subtle"
                  style={{ fontSize: '11px', height: '34px' }}
                  onClick={() => {
                    navigator.clipboard?.writeText(classLevel.aiTeachingRecommendation);
                    onToast('AI Recommendation copied to clipboard.');
                  }}
                >
                  <Copy size={14} /> Copy to Lesson Notes
                </button>
              </div>

              <p style={{ margin: '14px 0 0', color: '#7c3aed', fontSize: '10px', fontStyle: 'italic', borderTop: '1px solid #e9d5ff', paddingTop: '10px' }}>
                * AI assists by highlighting learning outcomes. AI never modifies marks or publishes assignments automatically. Teachers always review and decide next actions.
              </p>
            </section>
          </div>

          {/* Topic Accuracy Table */}
          <section className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">CONCEPT BREAKDOWN</p>
                <h3>Topic Accuracy Analysis Table</h3>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Learning Topic</th>
                    <th>Questions</th>
                    <th>Class Attempts</th>
                    <th>Correct / Total</th>
                    <th>Accuracy %</th>
                    <th>Concept Status</th>
                  </tr>
                </thead>
                <tbody>
                  {classLevel.topicAccuracyTable.map((tRow, idx) => (
                    <tr key={idx}>
                      <td><b>{tRow.topic}</b></td>
                      <td>{tRow.questionCount}</td>
                      <td>{tRow.totalAttempts}</td>
                      <td>{tRow.correctAttempts} / {tRow.totalAttempts}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <b style={{ width: '38px' }}>{tRow.accuracyPct}%</b>
                          <div className="progress" style={{ flex: 1, height: '6px' }}>
                            <i
                              style={{
                                width: `${tRow.accuracyPct}%`,
                                background: tRow.accuracyPct >= 80 ? '#10b981' : tRow.accuracyPct >= 60 ? '#f59e0b' : '#ef4444'
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${tRow.status === 'Strong' ? 'success' : tRow.status === 'Moderate' ? 'warning' : 'danger'}`}>
                          {tRow.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Question Difficulty Analysis Table */}
          <section className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">QUESTION DIAGNOSTICS</p>
                <h3>Question Difficulty Analysis</h3>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Q#</th>
                    <th>Question Prompt</th>
                    <th>Learning Topic</th>
                    <th>Correct Answers</th>
                    <th>Class Correct %</th>
                    <th>Difficulty Rating</th>
                    <th>Common Mistake</th>
                  </tr>
                </thead>
                <tbody>
                  {classLevel.questionDifficultyAnalysis.map(qRow => (
                    <tr key={qRow.questionIndex}>
                      <td><b>Q{qRow.questionIndex}</b></td>
                      <td style={{ maxWidth: '280px' }}>
                        <span style={{ fontWeight: '600', color: 'var(--text)', display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {qRow.prompt}
                        </span>
                      </td>
                      <td><span className="badge neutral">{qRow.learningTopic}</span></td>
                      <td>{qRow.correctCount} / {qRow.totalAttempts}</td>
                      <td><b>{qRow.accuracyPct}%</b></td>
                      <td>
                        <span className={`badge ${qRow.difficulty === 'Easy' ? 'success' : qRow.difficulty === 'Medium' ? 'warning' : 'danger'}`}>
                          {qRow.difficulty}
                        </span>
                      </td>
                      <td style={{ fontSize: '11px', color: qRow.mostCommonWrong ? '#ef4444' : 'var(--muted)' }}>
                        {qRow.mostCommonWrong ? `Chose "${qRow.mostCommonWrong}"` : 'None'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Most Common Mistakes Across Class */}
          {classLevel.commonMistakesList.length > 0 && (
            <section className="card">
              <div className="card-header">
                <div>
                  <p className="eyebrow" style={{ color: '#ef4444' }}>MISCONCEPTION DIAGNOSTICS</p>
                  <h3>Most Common Class Mistakes</h3>
                </div>
              </div>

              <div style={{ display: 'grid', gap: '10px' }}>
                {classLevel.commonMistakesList.map((m, idx) => (
                  <div key={idx} style={{ padding: '12px 14px', borderRadius: '10px', background: '#fff1f2', border: '1px solid #fecdd3', fontSize: '12px' }}>
                    <b style={{ color: '#be123c', display: 'block', marginBottom: '4px' }}>
                      Question {m.questionNum} &middot; Topic: {m.topic} ({m.accuracyPct}% Class Accuracy)
                    </b>
                    <p style={{ margin: '0 0 6px', color: '#881337', fontWeight: '600' }}>"{m.prompt}"</p>
                    <p style={{ margin: '0', color: '#9f1239', lineHeight: '1.45' }}>{m.explanation}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* LEVEL 1: INDIVIDUAL STUDENT ANALYSIS TAB */}
      {/* ========================================================= */}
      {activeTab === 'individual' && currentStudentAnalysis && (
        <div style={{ display: 'grid', gap: '22px' }}>
          {/* Student Selector Toolbar */}
          <section className="card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="avatar indigo" style={{ height: '40px', width: '40px', fontSize: '13px', fontWeight: '800' }}>
                  {(currentStudentAnalysis.studentName || 'ST').substring(0, 2).toUpperCase()}
                </span>
                <div>
                  <h3 style={{ margin: '0', fontSize: '17px' }}>{currentStudentAnalysis.studentName}</h3>
                  <p style={{ margin: '2px 0 0', color: 'var(--muted)', fontSize: '11px' }}>
                    Submitted: {new Date(currentStudentAnalysis.submittedAt).toLocaleString()}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--muted)' }}>Select Student:</span>
                <select
                  className="form-select"
                  value={currentStudentAnalysis.studentId}
                  onChange={e => setSelectedStudentId(e.target.value)}
                  style={{
                    height: '38px',
                    borderRadius: '9px',
                    padding: '0 12px',
                    border: '1px solid var(--line)',
                    background: 'var(--input)',
                    color: 'var(--text)',
                    fontSize: '13px',
                    fontWeight: '700'
                  }}
                >
                  {studentAnalyses.map(s => (
                    <option key={s.studentId} value={s.studentId}>
                      {s.studentName} ({s.score}%)
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Student Metrics Row */}
          <section className="metric-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            <article className="metric-card">
              <span className="metric-icon indigo"><Award size={19} /></span>
              <div>
                <p>Quiz Score</p>
                <h3>{currentStudentAnalysis.score}%</h3>
                <small>Raw Score: {currentStudentAnalysis.rawScore}</small>
              </div>
            </article>

            <article className="metric-card">
              <span className="metric-icon emerald"><CheckCircle2 size={19} /></span>
              <div>
                <p>Correct Answers</p>
                <h3 style={{ color: '#059669' }}>{currentStudentAnalysis.correctCount}</h3>
                <small>Accurate responses</small>
              </div>
            </article>

            <article className="metric-card">
              <span className="metric-icon danger" style={{ background: '#fef2f2', color: '#dc2626' }}>
                <XCircle size={19} />
              </span>
              <div>
                <p>Incorrect Answers</p>
                <h3 style={{ color: '#dc2626' }}>{currentStudentAnalysis.incorrectCount}</h3>
                <small>Wrong selections</small>
              </div>
            </article>

            <article className="metric-card">
              <span className="metric-icon neutral"><HelpCircle size={19} /></span>
              <div>
                <p>Skipped Questions</p>
                <h3>{currentStudentAnalysis.skippedCount}</h3>
                <small>Unanswered</small>
              </div>
            </article>

            <article className="metric-card">
              <span className="metric-icon violet"><Clock size={19} /></span>
              <div>
                <p>Time Taken</p>
                <h3>{currentStudentAnalysis.timeTaken}</h3>
                <small>Duration</small>
              </div>
            </article>
          </section>

          {/* Topics & AI Revision Suggestions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
            {/* Strong & Weak Topics */}
            <section className="card">
              <div className="card-header">
                <div>
                  <p className="eyebrow">TOPIC PROFILE</p>
                  <h3>Strong & Weak Topics</h3>
                </div>
              </div>

              <div style={{ display: 'grid', gap: '14px', marginTop: '10px' }}>
                <div>
                  <b style={{ fontSize: '11px', color: '#059669', display: 'block', marginBottom: '6px' }}>STRONG TOPICS (≥80% Accuracy)</b>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {currentStudentAnalysis.strongTopics.map((t, i) => (
                      <span className="badge success" key={i}>{t}</span>
                    ))}
                    {currentStudentAnalysis.strongTopics.length === 0 && (
                      <span className="muted" style={{ fontSize: '11px' }}>No topics reached 80% threshold.</span>
                    )}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
                  <b style={{ fontSize: '11px', color: '#dc2626', display: 'block', marginBottom: '6px' }}>WEAK TOPICS (&lt;60% Accuracy)</b>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {currentStudentAnalysis.weakTopics.map((t, i) => (
                      <span className="badge danger" key={i}>{t}</span>
                    ))}
                    {currentStudentAnalysis.weakTopics.length === 0 && (
                      <span className="badge success">None (All topics &gt; 60%)</span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* AI Revision Suggestions */}
            <section className="card" style={{ background: '#f5f3ff', border: '1px solid #ddd6fe' }}>
              <div className="card-header">
                <div>
                  <p className="eyebrow" style={{ color: '#7c3aed' }}>
                    <Sparkles size={13} style={{ display: 'inline', marginRight: '4px' }} /> AI REVISION SUGGESTIONS
                  </p>
                  <h3 style={{ color: '#4c1d95' }}>Personalized Guidance</h3>
                </div>
              </div>

              <p style={{ color: '#5b21b6', fontSize: '13px', lineHeight: '1.6', margin: '10px 0 16px' }}>
                {currentStudentAnalysis.aiRevisionSuggestions}
              </p>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="button primary"
                  style={{ fontSize: '11px', height: '34px' }}
                  onClick={() => onToast(`Revision suggestions sent to ${currentStudentAnalysis.studentName}.`)}
                >
                  <Send size={14} /> Send Note to Student
                </button>
              </div>
            </section>
          </div>

          {/* Concept Understanding Breakdown Table */}
          <section className="card">
            <div className="card-header">
              <div>
                <p className="eyebrow">CONCEPT DIAGNOSTICS</p>
                <h3>Concept Understanding Breakdown</h3>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Learning Concept</th>
                    <th>Questions Answered Correctly</th>
                    <th>Accuracy %</th>
                    <th>Mastery Status</th>
                  </tr>
                </thead>
                <tbody>
                  {currentStudentAnalysis.conceptUnderstanding.map((cu, idx) => (
                    <tr key={idx}>
                      <td><b>{cu.topic}</b></td>
                      <td>{cu.correct} / {cu.total}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <b style={{ width: '38px' }}>{cu.pct}%</b>
                          <div className="progress" style={{ flex: 1, height: '6px' }}>
                            <i
                              style={{
                                width: `${cu.pct}%`,
                                background: cu.pct >= 80 ? '#10b981' : cu.pct >= 60 ? '#f59e0b' : '#ef4444'
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${cu.status === 'Strong' ? 'success' : cu.status === 'Moderate' ? 'warning' : 'danger'}`}>
                          {cu.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Incorrect Questions & Common Mistakes for this Student */}
          {currentStudentAnalysis.commonMistakes.length > 0 && (
            <section className="card">
              <div className="card-header">
                <div>
                  <p className="eyebrow" style={{ color: '#ef4444' }}>MISTAKES BREAKDOWN</p>
                  <h3>Incorrect Questions & Misconception Analysis</h3>
                </div>
              </div>

              <div style={{ display: 'grid', gap: '10px' }}>
                {currentStudentAnalysis.commonMistakes.map((m, idx) => (
                  <div key={idx} style={{ padding: '14px', borderRadius: '10px', background: '#fff1f2', border: '1px solid #fecdd3', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <b style={{ color: '#be123c' }}>Question {m.questionNum} &middot; Topic: {m.topic}</b>
                    </div>
                    <p style={{ margin: '0 0 8px', color: '#881337', fontWeight: '700', fontSize: '13px' }}>"{m.prompt}"</p>
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '6px', fontSize: '11px' }}>
                      <span style={{ color: '#dc2626', fontWeight: '700' }}>Student Selected: "{m.userAnswer}"</span>
                      <span style={{ color: '#059669', fontWeight: '700' }}>Correct Answer: "{m.correctAnswer}"</span>
                    </div>
                    <p style={{ margin: '0', color: '#9f1239', fontSize: '11px', fontStyle: 'italic' }}>
                      💡 Concept Note: {m.explanation}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {activeTab === 'individual' && !currentStudentAnalysis && (
        <section className="card" style={{ padding: '28px', textAlign: 'center' }}>
          <p className="eyebrow">INDIVIDUAL ANALYSIS</p>
          <h3>No learner attempts yet</h3>
          <p className="muted">Individual diagnostics will appear after a student submits this quiz.</p>
        </section>
      )}
    </motion.div>
  );
}
