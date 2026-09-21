/**
 * Turning a result into a sentence.
 *
 * Every figure spoken aloud is read straight out of the typed result and
 * assembled here, in code. The language model is never asked to narrate a
 * number, because a spoken total is the one thing nobody can check against the
 * screen while they are walking away from it.
 */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const join = (parts) => {
  const kept = parts.filter(Boolean);
  if (kept.length <= 1) return kept.join("");
  return `${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]}`;
};

const attendance = (d) => {
  const who = d.employee?.name || "They";
  const head = `${who} was rostered for ${plural(d.scheduledShifts, "shift", "shifts")} in ${d.label}, and attended ${d.attendedShifts}.`;

  const problems = join([
    d.confirmedNoShows ? plural(d.confirmedNoShows, "no show", "no shows") : null,
    d.lateArrivals ? plural(d.lateArrivals, "late arrival", "late arrivals") : null,
    d.exceptions?.length ? plural(d.exceptions.length, "record needing attention", "records needing attention") : null,
  ]);

  const hours = `${d.elapsedHours} hours were clocked.`;
  const leave = d.approvedLeaveDays ? ` ${plural(d.approvedLeaveDays, "day", "days")} of approved leave.` : "";

  if (!problems) return `${head} ${hours}${leave} Nothing needs attention.`;
  return `${head} ${hours}${leave} There ${problems.includes("and") || /^\d+ [a-z]+s/.test(problems) ? "are" : "is"} ${problems}.`;
};

const shifts = (d) => {
  const who = d.employee?.name || "They";
  if (!d.count) return `${who} has no shifts rostered for ${d.window?.label}.`;

  const first = d.rows?.[0];
  const lead = `${who} has ${plural(d.count, "shift", "shifts")} in ${d.window?.label}.`;
  if (!first) return lead;
  return `${lead} The next one is at ${first.site || "an unassigned site"}, ${first.start}.`;
};

const created = (d) =>
  `Created. ${d.employee?.name} is on at ${d.site?.name}, ${d.start} to ${d.end}.`;

const employeeAdded = (d) =>
  `${d.employee?.name} has been added as ${d.position}. Their sign-in details have been emailed to ${d.email}. They have no shifts until you assign them to a site.`;

const dailySummary = (d) => {
  if (!d.totalShifts) return `No shifts are rostered${d.site ? ` at ${d.site}` : ""} for ${d.date}.`;
  const open = d.openShifts ? `, ${plural(d.openShifts, "open shift", "open shifts")}` : "";
  return `${d.isToday ? "Today" : d.date}${d.site ? ` at ${d.site}` : ""}: ${plural(d.totalShifts, "shift", "shifts")}${open}.`;
};

const employeeList = (d) => {
  if (!d.count) return d.site ? `No employees are assigned to ${d.site}.` : "No employees found.";
  const where = d.site ? ` at ${d.site}` : "";
  const tail = d.truncated ? `, showing the first ${d.count}` : "";
  return `${plural(d.count, "employee", "employees")}${where}${tail}. The list is on screen.`;
};

const shiftCancelled = (d) => {
  if (d.alreadyCancelled) return "That shift was already cancelled.";
  const who = d.employee ? `${d.employee}'s shift` : "The shift";
  return `${who}${d.site ? ` at ${d.site}` : ""}${d.start ? ` starting ${d.start}` : ""} has been cancelled.`;
};

/** What to say once a result is on screen. */
export const speakableResult = (envelope) => {
  if (!envelope?.data) return "";
  const { tool, data, replayed } = envelope;

  if (tool === "getAttendanceReport") return attendance(data);
  if (tool === "findEmployeeShifts") return shifts(data);
  if (tool === "getDailySummary") return dailySummary(data);
  if (tool === "listEmployees") return employeeList(data);
  if (tool === "listSites") return siteList(data);
  if (tool === "createShift") return replayed ? "That shift was already created." : created(data);
  if (tool === "cancelShift") return shiftCancelled(data);
  if (tool === "createEmployee") return replayed ? "That person was already added." : employeeAdded(data);
  if (tool === "createClient")
    return replayed ? "That client was already added." : `${data.client?.name} added as a client.`;
  if (tool === "createSite")
    return replayed
      ? "That site was already added."
      : `${data.site?.name} added under ${data.client}. Assign employees to it before rostering.`;
  if (tool === "updateEmployee")
    return `${data.employee} updated. ${(data.changes || []).join(", ")} changed.`;
  if (tool === "deactivateEmployee") {
    const n = data.cancelledShifts;
    const who = data.employee ? `${data.employee} deactivated.` : "Done.";
    return `${who} ${n > 0 ? `${plural(n, "upcoming shift", "upcoming shifts")} cancelled.` : "No upcoming shifts were affected."}`;
  }
  if (tool === "updateClient")
    return `${data.client} updated.`;
  if (tool === "updateSite")
    return `${data.site} updated.`;
  if (tool === "updateShift")
    return "The shift has been updated. Details are on screen.";
  return "Done. The details are on screen.";
};

/** What to say before a change, so a person can refuse it without looking. */
export const speakablePreview = (preview) => {
  if (!preview) return "";

  if (preview.action === "Add employee") {
    return `Add ${preview.employee} as ${preview.position}, email ${preview.email}. Say confirm to add them, or cancel.`;
  }

  if (preview.action === "Add client") {
    return `Add ${preview.client} as a client. Say confirm, or cancel.`;
  }

  if (preview.action === "Add site") {
    const head = `Add ${preview.site}, short code ${preview.shortName}, under ${preview.client}, timezone ${preview.timezone}.`;
    if (preview.location?.latitude != null) {
      return `${head} Geofence ${preview.geofence}. Say confirm, or cancel.`;
    }
    // A location cannot be dictated, so the choice is spelled out: set it on
    // screen, or knowingly add a site that anyone can clock in to from anywhere.
    return `${head} There is no geofence yet, so employees could clock in from anywhere. Set the location on screen, or say confirm to add it without one.`;
  }

  if (preview.action === "Cancel shift") {
    const who = preview.employee ? `${preview.employee}'s shift` : "this shift";
    return `Cancel ${who}${preview.site ? ` at ${preview.site}` : ""}${preview.start ? `, starting ${preview.start}` : ""}. Say confirm to cancel it, or say cancel to keep it.`;
  }

  if (preview.action === "Update employee") {
    const what = (preview.changes || []).join(", ");
    return `Update ${preview.employee}: ${what}. Say confirm or cancel.`;
  }

  if (preview.action === "Deactivate employee") {
    const n = preview.futureShiftsAffected;
    const shifts = n > 0 ? ` ${plural(n, "upcoming shift", "upcoming shifts")} will be cancelled.` : "";
    return `Deactivate ${preview.employee}.${shifts} Say confirm or cancel.`;
  }

  if (preview.action === "Update client") {
    const what = (preview.changes || []).join(", ");
    return `Update ${preview.client}: ${what}. Say confirm or cancel.`;
  }

  if (preview.action === "Update site") {
    const what = (preview.changes || []).join(", ");
    return `Update ${preview.site}: ${what}. Say confirm or cancel.`;
  }

  if (preview.action === "Update shift") {
    const what = (preview.changes || []).join(", ");
    return `Update ${preview.employee}'s shift at ${preview.site}: ${what}. Say confirm or cancel.`;
  }

  const overnight = preview.crossesMidnight ? ", finishing the following morning" : "";
  return `${preview.employee} at ${preview.site}, ${preview.start} to ${preview.end}${overnight}. That is ${preview.hours} hours. Say confirm to create it, or cancel.`;
};

const siteList = (d) => {
  if (!d.count) return "There are no sites set up yet.";
  const names = d.rows.slice(0, 5).map((r) => r.name);
  const rest = d.count - names.length;
  const tail = rest > 0 ? `, and ${rest} more` : "";
  let fence = "";
  if (d.unfenced === d.count) fence = " None of them have a geofence.";
  else if (d.unfenced === 1) fence = " 1 has no geofence.";
  else if (d.unfenced > 1) fence = ` ${d.unfenced} have no geofence.`;
  return `${plural(d.count, "site", "sites")}: ${join(names)}${tail}.${fence} The list is on screen.`;
};

/**
 * A question that came with its own answers. Spoken aloud the list has to be
 * short — nobody holds fifteen site names in their head — so past a few it
 * says how many there are and leaves the screen to show them.
 */
export const speakableChoice = (message, choice) => {
  const names = (choice?.candidates || []).map((c) => c.name);
  if (!names.length) return message;
  if (names.length > 4) {
    return `${message} There are ${names.length} to choose from, on screen.`;
  }
  return `${message} ${join(names)}.`;
};

/** What to say when something could not be done. */
export const speakableError = (error) => {
  if (!error) return "";

  if (error.code === "AMBIGUOUS_ENTITY") {
    const names = (error.details?.candidates || []).map((c) => c.name);
    if (names.length) return `${error.message} I found ${join(names)}.`;
  }

  if (error.code === "CONFLICT") {
    const clash = error.details?.conflicts?.[0];
    if (clash) return `${error.message}. It clashes with ${clash.start} to ${clash.end}.`;
  }

  return error.message;
};
