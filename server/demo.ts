import type { Demo } from "../shared/types";
export const demoScripts: Record<Demo, { at: number; text: string }[]> = {
  drift: [
    {
      at: 5,
      text: "First I would calculate the torque from the power and rotational speed, then determine the bending loads from the supports.",
    },
    {
      at: 13,
      text: "That reminds me of our college festival. I spent the weekend choosing a playlist and arranging snacks for the music event.",
    },
    {
      at: 23,
      text: "The food at the festival was wonderful. We talked about the music all evening and planned another party for next month.",
    },
  ],
  pause: [
    {
      at: 5,
      text: "First I would calculate the torque from the power and rotational speed, then determine the bending loads from the supports.",
    },
  ],
  thinking: [
    {
      at: 5,
      text: "First I would calculate the torque from the power and rotational speed, then determine the bending loads from the supports.",
    },
    {
      at: 15,
      text: "I would check fatigue because fluctuating stress can cause failure below yield. A keyway increases local stress so I would include a safety factor.",
    },
    {
      at: 25,
      text: "I would compare a larger diameter with an alloy steel material, because the extra weight and manufacturing cost might outweigh the gain in strength.",
    },
    {
      at: 35,
      text: "Then I would validate my design using FEA and a prototype test, while checking deflection and critical speed under operating conditions.",
    },
  ],
};
