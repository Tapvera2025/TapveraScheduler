import PageHeader from "../components/layout/PageHeader";
import Pagination from "../components/ui/Pagination";
import { Switch } from "../components/ui/Switch";
import ResponsiveTable, { MobileTableSort } from "../components/ui/ResponsiveTable";
import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Maximize, Minimize, RotateCw, Trash2, Edit, Search , Users } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import SortableHeader from "../components/ui/SortableHeader";
import toast from "react-hot-toast";
import { employeeApi } from "../lib/api";
import AddEmployeeModal from "../components/employees/AddEmployeeModal";
import { useFullscreen } from "../hooks/useFullscreen";
import { useTableSort } from "../hooks/useTableSort";

export default function Employees() {
  const pageRef = useRef(null);
  const { isFullscreen, toggleFullscreen, isSupported } = useFullscreen(pageRef);

  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0
  });

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);

  // Table sorting
  const { sortedData: sortedEmployees, sortConfig, requestSort, getSortIndicator } = useTableSort(employees, {
    defaultColumn: 'firstName',
    defaultDirection: 'asc',
  });

  // Fetch employees
  const fetchEmployees = useCallback(async () => {
    try {
      setLoading(true);
      const response = await employeeApi.getAll({
        search,
        isActive: showInactive ? undefined : true,
        page: pagination.page,
        limit: pagination.limit
      });
      setEmployees(response.data.data.employees);
      setPagination(prev => ({
        ...prev,
        ...response.data.data.pagination,
        totalPages: response.data.data.pagination.totalPages ?? response.data.data.pagination.pages ?? 1
      }));
    } catch (err) {
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  }, [search, showInactive, pagination.page, pagination.limit]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const handleAddNew = () => {
    setEditingEmployee(null);
    setIsModalOpen(true);
  };

  const handleEdit = (employee) => {
    setEditingEmployee(employee);
    setIsModalOpen(true);
  };

  const handleDelete = async (employeeId) => {
    if (!confirm('Are you sure you want to delete this employee?')) return;

    try {
      await employeeApi.delete(employeeId);
      toast.success('Employee deleted successfully');
      fetchEmployees();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete employee');
    }
  };

  const handleSaveEmployee = async (employeeData, selectedSiteIds = []) => {
    try {

      if (editingEmployee) {
        await employeeApi.update(editingEmployee.id, employeeData);
        toast.success('Employee updated successfully');

        // Assign sites if provided
        if (selectedSiteIds.length > 0) {
          await employeeApi.assignToSites(editingEmployee.id, selectedSiteIds);
          toast.success('Sites assigned successfully');
        }
      } else {
        const response = await employeeApi.create(employeeData);
        const createdEmployee = response.data.data;
        toast.success('Employee created successfully');

        // Assign sites if provided
        if (selectedSiteIds.length > 0) {
          await employeeApi.assignToSites(createdEmployee.id, selectedSiteIds);
          toast.success('Sites assigned successfully');
        }
      }
      setIsModalOpen(false);
      fetchEmployees();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save employee');
      throw err; // Re-throw to let modal know it failed
    }
  };

  const toggleSelectAll = () => {
    if (selectedEmployees.length === employees.length) {
      setSelectedEmployees([]);
    } else {
      setSelectedEmployees(employees.map(e => e.id));
    }
  };

  const toggleSelectEmployee = (employeeId) => {
    setSelectedEmployees(prev =>
      prev.includes(employeeId)
        ? prev.filter(id => id !== employeeId)
        : [...prev, employeeId]
    );
  };

  return (
    <div ref={pageRef} className="data-page">
      <PageHeader icon={Users} title="Employees" eyebrow="YOUR TEAM" description="The people behind every well-planned day." actions={<>
        <button className="icon-button" onClick={fetchEmployees} aria-label="Refresh employees"><RotateCw size={17} /></button>
        {isSupported && <button className="icon-button" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>{isFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>}
        <Button onClick={handleAddNew}><Plus size={16} />Add employee</Button>
      </>} />
      <div className="data-page-body">
        <div className="data-toolbar mb-5">
          <div className="data-toolbar-content">
            <div className="directory-search"><Search size={17} /><Input aria-label="Search employees" placeholder="Search name, email or phone…" value={search} onChange={(e) => { setSearch(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }} /></div>
            <div className="directory-filter-actions">
              <label className="directory-toggle"><Switch checked={showInactive} onCheckedChange={(value) => { setShowInactive(value); setPagination(prev => ({ ...prev, page: 1 })); }} />Include inactive</label>
              <label className="directory-page-size"><span>Per page</span><Select aria-label="Employees per page" value={pagination.limit} onChange={(e) => setPagination(prev => ({ ...prev, page: 1, limit: Number(e.target.value) }))}>{[25,50,100].map(n => <option key={n} value={n}>{n}</option>)}</Select></label>
            </div>
          </div>
        </div>
        <div className="data-table-surface rounded-xl overflow-hidden">
          <div className="directory-list-heading"><span>{pagination.total} employees</span><label><input type="checkbox" aria-label="Select all employees on this page" checked={employees.length > 0 && employees.every(e => selectedEmployees.includes(e.id))} onChange={toggleSelectAll} />{selectedEmployees.length ? `${selectedEmployees.length} selected` : "Select page"}</label></div>
          <MobileTableSort columns={[["firstName","Name"],["email","Email"],["phone","Mobile"],["isActive","Status"],["position","Position"],["department","Department"]]} sortConfig={sortConfig} onSort={requestSort} />
          <div className="overflow-x-auto">
            <ResponsiveTable aria-label="Employees">
              <thead role="rowgroup"><tr role="row">
                <th scope="col" className="sr-only">Select</th>
                {[['Name','firstName'],['Email','email'],['Mobile','phone'],['Status','isActive'],['Position','position'],['Department','department']].map(([label,key]) => <th key={key} scope="col" className="px-4 py-3"><SortableHeader label={label} sortKey={key} onSort={requestSort} sortDirection={getSortIndicator(key)} /></th>)}
                <th scope="col" className="px-4 py-3">Actions</th>
              </tr></thead>
              <tbody role="rowgroup">
                {loading ? <tr role="row"><td role="cell" colSpan={8} className="p-10 text-center text-foreground-muted">Loading employees…</td></tr> : sortedEmployees.length === 0 ? <tr role="row"><td role="cell" colSpan={8} className="p-10 text-center text-foreground-muted">No employees found. Try another search or add your first team member.</td></tr> : sortedEmployees.map(employee => <tr role="row" key={employee.id} className="border-b border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-surface))]">
                  <td role="cell" data-field="select" className="px-3"><input type="checkbox" aria-label={`Select ${employee.firstName} ${employee.lastName}`} checked={selectedEmployees.includes(employee.id)} onChange={() => toggleSelectEmployee(employee.id)} /></td>
                  <td role="cell" data-label="Employee" data-field="title" className="px-4 py-4"><button className="record-link" onClick={() => handleEdit(employee)}>{employee.firstName} {employee.lastName}</button></td>
                  <td role="cell" data-label="Email" data-field="wide" className="px-4 py-4">{employee.email ? <a href={`mailto:${employee.email}`}>{employee.email}</a> : '—'}</td>
                  <td role="cell" data-label="Mobile" className="px-4 py-4">{employee.phone ? <a href={`tel:${employee.phone}`}>{employee.phone}</a> : '—'}</td>
                  <td role="cell" data-label="Status" data-field="status" className="px-4 py-4"><span className={`attendance-status ${employee.isActive ? 'badge-success' : 'badge-neutral'}`}>{employee.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td role="cell" data-label="Position" className="px-4 py-4">{employee.position || '—'}</td>
                  <td role="cell" data-label="Department" className="px-4 py-4">{employee.department || '—'}</td>
                  <td role="cell" data-label="Actions" data-field="actions" className="px-4 py-4"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => handleEdit(employee)} aria-label={`Edit ${employee.firstName}`}><Edit size={14} /><span>Edit</span></Button><Button size="sm" variant="ghost" onClick={() => handleDelete(employee.id)} aria-label={`Delete ${employee.firstName}`} className="text-[hsl(var(--color-error))]"><Trash2 size={14} /><span className="mobile-action-label">Delete</span></Button></div></td>
                </tr>)}
              </tbody>
            </ResponsiveTable>
          </div>
          <Pagination {...pagination} loading={loading} noun="employees" onPageChange={page => { setSelectedEmployees([]); setPagination(prev => ({ ...prev, page })); }} />
        </div>
      </div>
      <AddEmployeeModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveEmployee} employee={editingEmployee} />
    </div>
  );
}
