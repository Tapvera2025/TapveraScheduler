import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import './src/index.css';
import WorkspaceLayout from './src/components/layout/WorkspaceLayout';
import Site from './src/components/sites/AddSiteModal';
import Sites from './src/components/sites/AddMultipleSitesModal';
import Client from './src/components/clients/AddClientModal';
import Clients from './src/components/clients/AddMultipleClientsModal';
import Employee from './src/components/employees/AddEmployeeModal';
import Leave from './src/components/leave/AddLeaveModal';
import Shift from './src/components/scheduler/AddShiftModal';
import Adhoc from './src/components/scheduler/AddAdhocShiftModal';
import Deleted from './src/components/scheduler/ViewDeletedShiftsModal';
const forms={Site,Sites,Client,Clients,Employee,Leave,Shift,Adhoc,Deleted};
function Review(){const [active,setActive]=useState(null);const Form=forms[active];return <div style={{padding:24}}><h1>Form layout review</h1>{Object.keys(forms).map(name=><button style={{padding:12}} key={name} onClick={()=>setActive(name)}>{name}</button>)}{Form&&<Form open isOpen onClose={()=>setActive(null)} onSave={()=>{}}/>}</div>}
createRoot(document.getElementById('root')).render(<React.StrictMode><MemoryRouter><Routes><Route element={<WorkspaceLayout role="master"/>}><Route path="/" element={<Review/>}/></Route></Routes></MemoryRouter></React.StrictMode>);
