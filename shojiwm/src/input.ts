import { COMPOSITOR } from "shoji_wm";

export function configureInput(): void {
  COMPOSITOR.input.configure((input) => {
    input.global = {
      keyboard: {
        layout: "us,ru",
        variant: ",",
        options: "grp:alt_shift_toggle",
        repeatRate: 25,
        repeatDelay: 300,
      },
      pointer: {
        accelProfile: "flat",
      },
    };
  });
}
