import React from 'react';
import '../../styles/admin/Tasks.css';
import { PulsePanel } from './AdminShared';
import { getJson, postJson } from '../../api/http';

export default function Tasks() {
  const [tab, setTab] = React.useState('all');
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  const loadTasks = React.useCallback(async () => {
    setLoading(true);
    try {
      const status = tab === 'done' ? 'done' : 'all';
      const data = await getJson(`/admin/tasks?status=${encodeURIComponent(status)}&limit=200`);
      const items = Array.isArray(data?.items) ? data.items : [];
      setRows(items);
    } catch (e) {
      setRows([]);
      alert(e?.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  React.useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const cards = React.useMemo(() => {
    const total = rows.length;
    const done = rows.filter((r) => String(r?.status || '').toLowerCase() === 'done').length;
    const inProgress = rows.filter((r) => String(r?.status || '').toLowerCase().includes('progress')).length;
    const overdue = rows.filter((r) => String(r?.status || '').toLowerCase() === 'overdue').length;
    return [
      { variant:'green', label:'Completed', value:String(done), actionLabel:'View List', iconClass:'fa-check' },
      { variant:'yellow', label:'In Progress', value:String(inProgress), actionLabel:'Review', iconClass:'fa-clock' },
      { variant:'red', label:'Overdue', value:String(overdue), actionLabel:'List', iconClass:'fa-triangle-exclamation' },
      { variant:'blue', label:'Total Tasks', value:String(total), actionLabel:'Open', iconClass:'fa-list-check' }
    ];
  }, [rows]);

  const filteredRows = React.useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    if (tab === 'all') return list;
    if (tab === 'team') return list.filter((r) => String(r?.assigned || '').toLowerCase() === 'you');
    if (tab === 'done') return list.filter((r) => String(r?.status || '').toLowerCase() === 'done');
    if (tab === 'insights') return list.filter((r) => String(r?.priority || '').toLowerCase() === 'high' || String(r?.status || '').toLowerCase() === 'overdue');
    return list;
  }, [tab, rows]);

  const createTask = async () => {
    try {
      await postJson('/admin/tasks', {
        title: 'New admin task',
        module: 'Operations',
        assigned: 'You',
        priority: 'Medium',
        due: 'Today',
        status: 'In Progress',
      });
      await loadTasks();
    } catch (e) {
      alert(e?.message || 'Failed to create task');
    }
  };

  const markDone = async (taskId) => {
    try {
      await postJson(`/admin/tasks/${encodeURIComponent(taskId)}/complete`, {});
      await loadTasks();
    } catch (e) {
      alert(e?.message || 'Failed to mark task done');
    }
  };

  const reassignTask = async (taskId) => {
    try {
      await postJson(`/admin/tasks/${encodeURIComponent(taskId)}/reassign`, { assigned: 'Support' });
      await loadTasks();
    } catch (e) {
      alert(e?.message || 'Failed to reassign task');
    }
  };


  return (
    <div className="tasks-root">
        <header className="fp-header adm-analytics-header">
        <div className="fp-header-titles"><h2>Tasks & To-Do Overview</h2></div>
      </header>
      <div className="tasks-actions" style={{marginBottom: '20px'}}>
          <button className="btn small-cd" type="button" onClick={createTask}>+ New Task</button>
          <button className="btn small ghost-cd" type="button" onClick={loadTasks}>Auto-Assign</button>
        </div>

        <PulsePanel cards={cards} />

      <div className="tasks-main" style={{marginTop: '20px'}}>
        <div className="tasks-table-wrap">
          <div className="tabs" style={{marginBottom: '10px', marginLeft: '20px'}}>
            <button className={`tab ${tab==='all' ? 'active' : ''}`} onClick={() => setTab('all')}>All Tasks</button>
            <button className={`tab ${tab==='team' ? 'active' : ''}`} onClick={() => setTab('team')}>My Team</button>
            <button className={`tab ${tab==='done' ? 'active' : ''}`} onClick={() => setTab('done')}>Completed</button>
            <button className={`tab ${tab==='insights' ? 'active' : ''}`} onClick={() => setTab('insights')}>Insights</button>
          </div>
          <table className="tasks-table">
            <thead>
              <tr><th>Task</th><th>Module</th><th>Assigned To</th><th>Priority</th><th>Due Date</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7}>Loading tasks...</td></tr>
              ) : filteredRows.map((r,i) => (
                <tr key={i} className={`task-row ${r.status === 'Overdue' ? 'overdue' : ''}`}>
                  <td className="task-title">{r.title}</td>
                  <td>{r.module}</td>
                  <td>{r.assigned}</td>
                  <td><span className={`int-status-badge ${r.priority.toLowerCase() === 'high' ? 'disconnected' : r.priority.toLowerCase() === 'medium' ? 'warning' : 'active'}`}>{r.priority}</span></td>
                  <td>{r.due}</td>
                  <td><span className={`int-status-badge ${r.status === 'Done' ? 'resolved' : r.status === 'Overdue' ? 'revoked' : 'in-progress'}`}>{r.status}</span></td>
                  <td><div className="task-actions"><button type="button" className="card-action" onClick={() => markDone(r.id)}>Done</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="tasks-right">
          <div className="team-performance">
            <h4 style={{fontWeight: '700'}}>Team Performance</h4>
            <div className="tp-row"><div className="tp-label">Team Efficiency</div><div className="tp-value">91% <span className="tp-arrow up">↗</span></div></div>
            <div className="tp-progress"><div className="tp-fill" style={{width:'91%'}}/></div>
            <div className="tp-row"><div className="tp-label">On-time Tasks</div><div className="tp-value">87% <span className="tp-arrow down">↘</span></div></div>
            <div className="tp-progress small"><div className="tp-fill amber" style={{width:'87%'}}/></div>
            <div className="tp-row small"><div className="tp-label">Avg Delay</div><div className="tp-value">3h</div></div>
            <div className="tp-row small"><div className="tp-label">Workload</div><div className="tp-value">+8% <span className="tp-arrow up small">↗</span></div></div>
          </div>

          <div className="task-detail">
            <h4 style={{fontWeight: '700'}}>Task Details</h4>
              <div className="detail-row header-title">Verify carrier documents</div>
              <div className="detail-row"><div className="detail-label">Status:</div><div className="detail-value"><span className="int-status-badge in-progress">In Progress</span></div></div>
              <div className="detail-row"><div className="detail-label">Priority:</div><div className="detail-value"><span className="int-status-badge revoked">High</span></div></div>
              <div className="detail-row"><div className="detail-label">Module:</div><div className="detail-value">Compliance</div></div>
              <div className="detail-row"><div className="detail-label">Assigned to:</div><div className="detail-value">Lisa</div></div>
              <div className="detail-row"><div className="detail-label">Due Date:</div><div className="detail-value">Oct 14</div></div>
              <div className="detail-row"><div className="detail-label">Progress:</div><div className="detail-value">75%</div></div>
              <div className="detail-row progress-row"><div className="progress"><div className="progress-fill" style={{width:'75%'}}/></div></div>
            <div style={{marginTop:12}}><button className="btn small-cd" type="button" disabled={!filteredRows[0]?.id} onClick={() => filteredRows[0]?.id && markDone(filteredRows[0].id)}>Mark Done</button> <button className="btn small ghost-cd" type="button" disabled={!filteredRows[0]?.id} onClick={() => filteredRows[0]?.id && reassignTask(filteredRows[0].id)}>Reassign</button></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
