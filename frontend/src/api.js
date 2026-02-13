import axios from "axios";

export const sendAudioToBackend = async (formData) => {
  const response = await axios.post(
    "https://speech-chatbot-backend-url/api/recognize", 
    formData
  );
  return response.data;
};
