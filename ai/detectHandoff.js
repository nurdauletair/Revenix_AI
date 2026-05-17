function detectHandoffByKeywords(text = "") {
  const lower = String(text).toLowerCase();

  const keywords = [
    "менеджер",
    "оператор",
    "человек",
    "живой человек",
    "позвоните",
    "перезвоните",
    "свяжитесь",
    "свяжитесь со мной",
    "хочу поговорить",
    "можно с человеком",
    "адам",
    "оператормен",
    "менеджермен",
    "қоңырау",
    "хабарласыңыз",
    "қоңырау шалыңыз",
    "звондаңыз",
  ];

  return keywords.some((word) => lower.includes(word));
}

async function detectHandoff({ userText }) {
  if (detectHandoffByKeywords(userText)) {
    return {
      handoff_required: true,
      reason: "Клиент попросил менеджера/звонок",
    };
  }

  return {
    handoff_required: false,
    reason: "",
  };
}

module.exports = {
  detectHandoff,
  detectHandoffByKeywords,
};