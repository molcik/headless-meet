'use client';
import React, { ChangeEvent, FormEvent, useState } from "react"

export default function Home() {

  const [formData, setFormData] = useState({
    id: ""
  });

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const fieldName = event.target.name;
    const fieldValue = event.target.value;

    setFormData((prevState) => ({
      ...prevState,
      [fieldName]: fieldValue
    }));
  }

  const onJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const res = await fetch(`/api/join/${formData.id}`)
    console.log(res)
  }

  const onEnd = () => {
    fetch(`/api/end`)
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">

      <form onSubmit={onJoin}>
      <div className="mb-6">
          <label className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Google Meet ID</label>
          <input
            onChange={handleInput}
            value={formData.id}
            type="text"
            name="id"
            className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
            placeholder="xxx-xxx-xxx"
            required />
        </div>
        <div className="flex space-x-4">
         
          <button type="submit"
            className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800">Join</button>

        </div>
      </form>

      <form onSubmit={onEnd}>
        <button type="submit"
            className="text-white bg-red-700 hover:bg-red-800 focus:ring-4 focus:outline-none focus:ring-red-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-red-600 dark:hover:bg-red-700 dark:focus:ring-red-800">End</button>
      </form>

    </main>
  );
}
