import React, { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  getDocs,
  deleteDoc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import {
  Camera,
  Users,
  BarChart2,
  History,
  UserPlus,
  X,
  Edit,
  Trash2,
  CheckCircle,
  Info,
  Loader,
  XCircle,
} from "lucide-react";

// --- Konfigurasi Firebase (Ditempatkan Langsung di Sini) ---
// Cara ini paling pasti untuk deployment di GitHub Pages.
// Pastikan Security Rules di Firebase Console sudah Anda atur.
const firebaseConfig = {
  apiKey: "AIzaSyCQk2Q0Y_kotZ91V4th-hx1C5NVs4M9fSI",
  authDomain: "absensi-tpq-ku.firebaseapp.com",
  projectId: "absensi-tpq-ku",
  storageBucket: "absensi-tpq-ku.appspot.com",
  messagingSenderId: "749561123997",
  appId: "1:749561123997:web:d1d6a89f10eea11044f074",
  measurementId: "G-72WWMYFM9Q",
};

// ID unik untuk memisahkan data aplikasi ini di database.
const appId = "absensi-pengajian-online";

// --- Komponen Pengganti untuk Membuat QR Code ---
const QRCodeGenerator = ({ value, size }) => {
  const canvasRef = useRef(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    const scriptId = "qrious-script";
    if (document.getElementById(scriptId) || window.QRious) {
      setScriptLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.id = scriptId;
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js";
    script.onload = () => setScriptLoaded(true);
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    if (scriptLoaded && canvasRef.current && window.QRious) {
      try {
        new window.QRious({
          element: canvasRef.current,
          value: value,
          size: size,
          level: "H",
        });
      } catch (error) {
        console.error("Failed to generate QR code:", error);
      }
    }
  }, [scriptLoaded, value, size]);

  if (!scriptLoaded)
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center bg-gray-200 rounded-md"
      >
        <Loader size={size / 2} className="animate-spin" />
      </div>
    );

  return <canvas ref={canvasRef} />;
};

// --- Komponen Pengganti untuk Memindai QR Code ---
const QRScanner = ({ onScanSuccess }) => {
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    const scriptId = "html5-qrcode-script";
    if (document.getElementById(scriptId) || window.Html5Qrcode) {
      setScriptLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
    script.onload = () => setScriptLoaded(true);
    script.onerror = () => console.error("Failed to load QR scanner script.");
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    let html5QrCode;
    if (scriptLoaded && window.Html5Qrcode) {
      try {
        html5QrCode = new window.Html5Qrcode("reader");
        const qrCodeSuccessCallback = (decodedText, decodedResult) => {
          onScanSuccess(decodedText);
        };
        const config = { fps: 10, qrbox: { width: 250, height: 250 } };

        html5QrCode
          .start({ facingMode: "environment" }, config, qrCodeSuccessCallback)
          .catch((err) =>
            console.error(`Unable to start scanning, error: ${err}`)
          );
      } catch (error) {
        console.error("Could not instantiate QR Scanner.", error);
      }
    }

    return () => {
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode
          .stop()
          .catch((err) =>
            console.error("Failed to stop scanner on cleanup.", err)
          );
      }
    };
  }, [scriptLoaded, onScanSuccess]);

  return (
    <div id="reader" style={{ width: "100%", height: "100%" }}>
      {!scriptLoaded && (
        <div className="w-full h-full flex items-center justify-center bg-gray-200">
          <Loader size={48} className="animate-spin" />
        </div>
      )}
    </div>
  );
};

// --- Komponen Utama Aplikasi ---
export default function App() {
  // --- State Management ---
  const [db, setDb] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [currentDateTime, setCurrentDateTime] = useState(new Date());

  const [currentView, setCurrentView] = useState("attendance");
  const [students, setStudents] = useState([]);
  const [attendanceLog, setAttendanceLog] = useState([]);
  const [notification, setNotification] = useState(null);
  const [isProcessingScan, setIsProcessingScan] = useState(false);

  const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [newStudentName, setNewStudentName] = useState("");
  const [newStudentId, setNewStudentId] = useState("");

  const [reportType, setReportType] = useState("daily");
  const [reportData, setReportData] = useState([]);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [selectedMonth, setSelectedMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );

  // --- Inisialisasi Firebase & Autentikasi ---
  useEffect(() => {
    if (!firebaseConfig || Object.keys(firebaseConfig).length === 0) {
      console.error("Firebase config is missing!");
      setNotification({
        type: "error",
        message: "Konfigurasi Firebase tidak ditemukan!",
      });
      return;
    }
    try {
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const firebaseAuth = getAuth(app);
      setDb(firestoreDb);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (!user) {
          try {
            await signInAnonymously(firebaseAuth);
          } catch (error) {
            console.error("Authentication Error:", error);
          }
        }
        setIsAuthReady(true);
      });
      return () => unsubscribe();
    } catch (error) {
      console.error("Firebase Initialization Error:", error);
      setNotification({
        type: "error",
        message: "Gagal menginisialisasi Firebase.",
      });
    }
  }, []);

  // --- Efek untuk Timer Jam & Tanggal ---
  useEffect(() => {
    const timer = setInterval(() => setCurrentDateTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // --- Pengambilan Data Real-time ---
  useEffect(() => {
    if (!isAuthReady || !db) return;

    const studentsQuery = query(
      collection(db, "artifacts", appId, "public", "data", "students"),
      orderBy("name")
    );
    const unsubscribeStudents = onSnapshot(
      studentsQuery,
      (querySnapshot) => {
        const studentsData = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setStudents(studentsData);
      },
      (error) => console.error("Error fetching students: ", error)
    );

    const todayStr = new Date().toISOString().split("T")[0];
    const attendanceQuery = query(
      collection(db, "artifacts", appId, "public", "data", "attendance"),
      where("dateString", "==", todayStr)
    );
    const unsubscribeAttendance = onSnapshot(
      attendanceQuery,
      (querySnapshot) => {
        const logData = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        const sortedLog = logData.sort(
          (a, b) => b.timestamp.seconds - a.timestamp.seconds
        );
        setAttendanceLog(sortedLog.slice(0, 5));
      },
      (error) => console.error("Error fetching attendance log: ", error)
    );

    return () => {
      unsubscribeStudents();
      unsubscribeAttendance();
    };
  }, [isAuthReady, db]);

  // --- Timer Notifikasi ---
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // --- Fungsi Pemindaian QR Code ---
  const handleScan = useCallback(
    async (decodedText) => {
      if (decodedText && !isProcessingScan) {
        setIsProcessingScan(true);
        const student = students.find((s) => s.studentId === decodedText);
        if (!student) {
          setNotification({
            type: "error",
            message: `Jamaah dengan ID ${decodedText} tidak ditemukan.`,
          });
          setTimeout(() => setIsProcessingScan(false), 3000);
          return;
        }

        const todayStr = new Date().toISOString().split("T")[0];
        const attendanceRef = collection(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "attendance"
        );
        const q = query(
          attendanceRef,
          where("studentId", "==", decodedText),
          where("dateString", "==", todayStr)
        );

        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          setNotification({
            type: "info",
            message: `${student.name} sudah tercatat hadir hari ini.`,
          });
          setTimeout(() => setIsProcessingScan(false), 3000);
          return;
        }

        try {
          await addDoc(attendanceRef, {
            studentId: decodedText,
            studentName: student.name,
            timestamp: Timestamp.now(),
            dateString: todayStr,
          });
          setNotification({
            type: "success",
            message: `Kehadiran ${student.name} berhasil dicatat!`,
          });
        } catch (error) {
          setNotification({
            type: "error",
            message: "Gagal menyimpan absensi.",
          });
        } finally {
          setTimeout(() => setIsProcessingScan(false), 2000);
        }
      }
    },
    [isProcessingScan, students, db]
  );

  // --- Fungsi Manajemen Jamaah (CRUD) ---
  const handleOpenStudentModal = (student = null) => {
    setEditingStudent(student);
    setNewStudentName(student ? student.name : "");
    setNewStudentId(student ? student.studentId : "");
    setIsStudentModalOpen(true);
  };

  const handleCloseStudentModal = () => setIsStudentModalOpen(false);

  const handleSaveStudent = async () => {
    if (!newStudentName || !newStudentId) return;
    const studentData = { name: newStudentName, studentId: newStudentId };
    try {
      if (editingStudent) {
        const studentRef = doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "students",
          editingStudent.id
        );
        await updateDoc(studentRef, studentData);
        setNotification({
          type: "success",
          message: "Data jamaah berhasil diperbarui.",
        });
      } else {
        const studentRef = doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "students",
          newStudentId
        );
        const docSnap = await getDoc(studentRef);
        if (docSnap.exists()) {
          setNotification({
            type: "error",
            message: `ID Jamaah ${newStudentId} sudah digunakan.`,
          });
          return;
        }
        await setDoc(studentRef, {
          ...studentData,
          createdAt: Timestamp.now(),
        });
        setNotification({
          type: "success",
          message: "Jamaah baru berhasil ditambahkan.",
        });
      }
      handleCloseStudentModal();
    } catch (error) {
      setNotification({ type: "error", message: "Gagal menyimpan data." });
    }
  };

  const handleDeleteStudent = async (studentDocId) => {
    try {
      await deleteDoc(
        doc(db, "artifacts", appId, "public", "data", "students", studentDocId)
      );
      setNotification({ type: "success", message: "Jamaah berhasil dihapus." });
    } catch (error) {
      setNotification({ type: "error", message: "Gagal menghapus data." });
    }
  };

  // --- Fungsi Laporan ---
  const generateReport = useCallback(async () => {
    if (!db) return;
    setReportData([]);
    const attendanceRef = collection(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      "attendance"
    );
    let q;

    if (reportType === "daily") {
      q = query(
        attendanceRef,
        where("dateString", "==", selectedDate),
        orderBy("timestamp", "asc")
      );
      const querySnapshot = await getDocs(q);
      setReportData(querySnapshot.docs.map((doc) => doc.data()));
    } else if (reportType === "monthly") {
      const [year, month] = selectedMonth.split("-");
      const startDate = `${selectedMonth}-01`;
      const daysInMonth = new Date(year, month, 0).getDate();
      const endDateStr = `${selectedMonth}-${String(daysInMonth).padStart(
        2,
        "0"
      )}`;

      q = query(
        attendanceRef,
        where("dateString", ">=", startDate),
        where("dateString", "<=", endDateStr)
      );
      const querySnapshot = await getDocs(q);
      const monthlyAttendance = querySnapshot.docs.map((doc) => doc.data());

      const processedData = students.map((student) => {
        const attendanceByDate = {};
        for (let i = 1; i <= daysInMonth; i++) {
          const dateStr = `${selectedMonth}-${String(i).padStart(2, "0")}`;
          attendanceByDate[i] = monthlyAttendance.some(
            (att) =>
              att.studentId === student.studentId && att.dateString === dateStr
          );
        }
        const totalHadir =
          Object.values(attendanceByDate).filter(Boolean).length;
        return {
          studentId: student.studentId,
          name: student.name,
          attendance: attendanceByDate,
          total: totalHadir,
          totalAlpa: daysInMonth - totalHadir,
        };
      });
      setReportData(processedData);
    }
  }, [db, reportType, selectedDate, selectedMonth, students]);

  useEffect(() => {
    if (isAuthReady) {
      generateReport();
    }
  }, [isAuthReady, generateReport, reportType, selectedDate, selectedMonth]);

  // --- Komponen Tampilan ---
  const AttendanceView = () => (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start mb-8">
        {/* Kolom Scanner */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-lg w-full">
          <h2 className="text-2xl font-bold mb-4 flex items-center">
            <Camera className="mr-3 text-indigo-500" />
            Pindai QR Code Jamaah
          </h2>
          <div className="w-full aspect-square bg-slate-900 rounded-lg overflow-hidden relative">
            <QRScanner onScanSuccess={handleScan} />
            {isProcessingScan && (
              <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center text-white">
                <Loader className="animate-spin mr-2" /> Memproses...
              </div>
            )}
          </div>
          <p className="text-center mt-4 text-slate-500 dark:text-slate-400">
            Arahkan kamera ke QR code jamaah.
          </p>
        </div>
        {/* Kolom Riwayat */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-lg w-full">
          <h2 className="text-2xl font-bold mb-4 flex items-center">
            <History className="mr-3 text-indigo-500" />
            Riwayat Absen Hari Ini
          </h2>
          <div className="space-y-3">
            {attendanceLog.length > 0 ? (
              attendanceLog.map((log) => (
                <div
                  key={log.id}
                  className="bg-slate-100 dark:bg-slate-700/50 p-3 rounded-lg flex justify-between items-center"
                >
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-white">
                      {log.studentName}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      ID: {log.studentId}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    {new Date(log.timestamp.seconds * 1000).toLocaleTimeString(
                      "id-ID"
                    )}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-slate-500 dark:text-slate-400 text-center py-4">
                Belum ada jamaah yang absen hari ini.
              </p>
            )}
          </div>
        </div>
      </div>
      {/* Laporan di bawahnya */}
      <ReportsView />
    </div>
  );

  const StudentManagementView = () => (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-lg">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold flex items-center">
          <Users className="mr-3 text-indigo-500" />
          Manajemen Data Jamaah
        </h2>
        <button
          onClick={() => handleOpenStudentModal()}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg shadow-md hover:bg-indigo-700 transition"
        >
          <UserPlus size={18} /> Tambah Jamaah
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="border-b-2 border-slate-200 dark:border-slate-700">
            <tr>
              <th className="p-3">Nama</th>
              <th className="p-3">ID Jamaah</th>
              <th className="p-3">QR Code</th>
              <th className="p-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr
                key={s.id}
                className="border-b border-slate-100 dark:border-slate-700/50"
              >
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3 text-slate-500 dark:text-slate-400">
                  {s.studentId}
                </td>
                <td className="p-3">
                  <QRCodeGenerator value={s.studentId} size={48} />
                </td>
                <td className="p-3 text-right">
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => handleOpenStudentModal(s)}
                      className="p-2 text-blue-500 hover:bg-blue-100 dark:hover:bg-slate-700 rounded-md"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => handleDeleteStudent(s.id)}
                      className="p-2 text-red-500 hover:bg-red-100 dark:hover:bg-slate-700 rounded-md"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td colSpan="4" className="text-center p-8 text-slate-500">
                  Tidak ada data jamaah.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const ReportsView = () => (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-lg">
      <h2 className="text-2xl font-bold mb-6 flex items-center">
        <BarChart2 className="mr-3 text-indigo-500" />
        Laporan Kehadiran
      </h2>
      <div className="flex flex-wrap gap-4 items-center mb-6 p-4 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
        <div className="flex gap-2">
          <button
            onClick={() => setReportType("daily")}
            className={`px-4 py-2 rounded-md ${
              reportType === "daily"
                ? "bg-indigo-600 text-white"
                : "bg-white dark:bg-slate-600"
            }`}
          >
            Harian
          </button>
          <button
            onClick={() => setReportType("monthly")}
            className={`px-4 py-2 rounded-md ${
              reportType === "monthly"
                ? "bg-indigo-600 text-white"
                : "bg-white dark:bg-slate-600"
            }`}
          >
            Bulanan
          </button>
        </div>
        {reportType === "daily" ? (
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-white dark:bg-slate-600 p-2 rounded-md border border-slate-300 dark:border-slate-500"
          />
        ) : (
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-white dark:bg-slate-600 p-2 rounded-md border border-slate-300 dark:border-slate-500"
          />
        )}
        <button
          onClick={generateReport}
          className="flex items-center gap-2 bg-slate-200 dark:bg-slate-600 px-4 py-2 rounded-lg shadow-sm hover:bg-slate-300 dark:hover:bg-slate-500 transition"
        >
          Lihat Laporan
        </button>
      </div>
      <div className="overflow-x-auto">
        {reportType === "daily" && (
          <table className="w-full text-left">
            <thead className="border-b-2 border-slate-200 dark:border-slate-700">
              <tr>
                <th className="p-3">Nama</th>
                <th className="p-3">ID Jamaah</th>
                <th className="p-3">Waktu Absen</th>
              </tr>
            </thead>
            <tbody>
              {reportData.map((r, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-100 dark:border-slate-700/50"
                >
                  <td className="p-3 font-medium">{r.studentName}</td>
                  <td className="p-3">{r.studentId}</td>
                  <td className="p-3">
                    {new Date(r.timestamp.seconds * 1000).toLocaleTimeString(
                      "id-ID"
                    )}
                  </td>
                </tr>
              ))}
              {reportData.length === 0 && (
                <tr>
                  <td colSpan="3" className="text-center p-8 text-slate-500">
                    Tidak ada data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {reportType === "monthly" && (
          <table className="w-full text-left border-collapse">
            <thead className="border-b-2 border-slate-200 dark:border-slate-700">
              <tr>
                <th className="p-2 sticky left-0 bg-white dark:bg-slate-800">
                  Nama Jamaah
                </th>
                {[
                  ...Array(
                    new Date(
                      selectedMonth.split("-")[0],
                      selectedMonth.split("-")[1],
                      0
                    ).getDate()
                  ).keys(),
                ].map((i) => (
                  <th key={i} className="p-2 text-center w-12">
                    {i + 1}
                  </th>
                ))}
                <th className="p-2 text-center bg-green-100 dark:bg-green-900/50">
                  H
                </th>
                <th className="p-2 text-center bg-red-100 dark:bg-red-900/50">
                  A
                </th>
              </tr>
            </thead>
            <tbody>
              {reportData.map((r) => (
                <tr
                  key={r.studentId}
                  className="border-b border-slate-100 dark:border-slate-700/50"
                >
                  <td className="p-2 font-medium sticky left-0 bg-white dark:bg-slate-800 whitespace-nowrap">
                    {r.name}
                  </td>
                  {Object.values(r.attendance).map((attended, i) => (
                    <td
                      key={i}
                      className={`text-center p-2 ${
                        attended
                          ? "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300"
                          : "bg-red-50 dark:bg-red-500/10 text-red-500"
                      }`}
                    >
                      {attended ? "✓" : "–"}
                    </td>
                  ))}
                  <td className="p-2 text-center font-bold bg-green-100 dark:bg-green-900/50">
                    {r.total}
                  </td>
                  <td className="p-2 text-center font-bold bg-red-100 dark:bg-red-900/50">
                    {r.totalAlpa}
                  </td>
                </tr>
              ))}
              {reportData.length === 0 && (
                <tr>
                  <td
                    colSpan={
                      new Date(
                        selectedMonth.split("-")[0],
                        selectedMonth.split("-")[1],
                        0
                      ).getDate() + 3
                    }
                    className="text-center p-8 text-slate-500"
                  >
                    Tidak ada data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  const renderContent = () => {
    if (!isAuthReady)
      return (
        <div className="text-center p-10">
          <Loader className="animate-spin inline-block" /> Memuat aplikasi...
        </div>
      );
    if (currentView === "management") {
      return <StudentManagementView />;
    }
    return <AttendanceView />;
  };

  return (
    <div className="bg-slate-100 dark:bg-slate-900 min-h-screen font-sans text-slate-800 dark:text-slate-200 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
            <div>
              <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Absensi Pengajian
              </h1>
              <p className="mt-2 text-lg text-slate-600 dark:text-slate-400">
                Selamat datang di aplikasi absensi pengajian.
              </p>
            </div>
            <div className="mt-4 sm:mt-0 text-right bg-white dark:bg-slate-800 p-3 rounded-lg shadow">
              <p className="text-2xl font-semibold text-indigo-600 dark:text-indigo-400">
                {currentDateTime.toLocaleTimeString("id-ID", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: "Asia/Jakarta",
                })}
                <span className="text-sm ml-2 align-baseline bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-1 rounded">
                  WIB
                </span>
              </p>
              <p className="text-slate-500 dark:text-slate-400 mt-1">
                {currentDateTime.toLocaleDateString("id-ID", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  timeZone: "Asia/Jakarta",
                })}
              </p>
            </div>
          </div>
        </header>
        <nav className="flex space-x-2 mb-8 bg-white dark:bg-slate-800 p-2 rounded-xl shadow-md">
          <button
            onClick={() => setCurrentView("attendance")}
            className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all ${
              currentView === "attendance"
                ? "bg-indigo-600 text-white shadow"
                : "hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            <Camera />
            <span>Absensi</span>
          </button>
          <button
            onClick={() => setCurrentView("management")}
            className={`flex-1 py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all ${
              currentView === "management"
                ? "bg-indigo-600 text-white shadow"
                : "hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            <Users />
            <span>Jamaah</span>
          </button>
        </nav>
        <main>{renderContent()}</main>
      </div>
      {isStudentModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">
                {editingStudent ? "Edit Data Jamaah" : "Tambah Jamaah Baru"}
              </h3>
              <button
                onClick={handleCloseStudentModal}
                className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="studentName"
                  className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1"
                >
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  id="studentName"
                  value={newStudentName}
                  onChange={(e) => setNewStudentName(e.target.value)}
                  className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md border border-slate-300 dark:border-slate-600"
                />
              </div>
              <div>
                <label
                  htmlFor="studentId"
                  className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1"
                >
                  ID Jamaah (Unik)
                </label>
                <input
                  type="text"
                  id="studentId"
                  value={newStudentId}
                  onChange={(e) => setNewStudentId(e.target.value)}
                  disabled={!!editingStudent}
                  className="w-full p-2 bg-slate-100 dark:bg-slate-700 rounded-md border border-slate-300 dark:border-slate-600 disabled:opacity-50"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSaveStudent}
                className="bg-indigo-600 text-white px-5 py-2 rounded-lg shadow-md hover:bg-indigo-700 transition"
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}
      {notification && (
        <div
          className={`fixed bottom-5 right-5 p-4 rounded-lg shadow-xl text-white flex items-center gap-3 animate-fade-in-out z-50 ${
            notification.type === "success" ? "bg-green-600" : ""
          } ${notification.type === "error" ? "bg-red-600" : ""} ${
            notification.type === "info" ? "bg-blue-600" : ""
          }`}
        >
          {notification.type === "success" && <CheckCircle />}{" "}
          {notification.type === "error" && <XCircle />}{" "}
          {notification.type === "info" && <Info />}
          <span>{notification.message}</span>
        </div>
      )}
    </div>
  );
}
