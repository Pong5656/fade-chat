import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
      <h1 className="text-lg font-semibold">ไม่พบห้องนี้</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        รหัสห้องอาจไม่ถูกต้อง หรือพิมพ์ไม่ครบ ลองตรวจสอบรหัสอีกครั้ง
      </p>
      <Link
        href="/"
        className="mt-4 inline-flex rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700"
      >
        กลับหน้าแรก
      </Link>
    </div>
  );
}
