// 파이어베이스 웹 앱 설정값
// 파이어베이스 콘솔 → 프로젝트 설정 → 내 앱 → 웹 앱의 firebaseConfig 값을 그대로 붙여 넣어요.
// 이 값은 웹 페이지에 공개돼도 괜찮은 값이에요. 데이터는 firestore.rules가 지켜 줍니다.
// 비워 두면 진행판은 로그인 없이, 이 기기에만 저장하며 동작해요.
export const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};
