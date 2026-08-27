# Quick-start example for the Manim Slides Preview extension.
# Open this file in VS Code and click the ▶ play button in the editor title bar.
# Then edit anything and press Ctrl+S — the interactive preview refreshes itself.

from manim import *
from manim_slides import Slide


class Demo(Slide):
    def construct(self):
        title = Text("Manim Slides Preview", font_size=48)
        self.play(Write(title))
        self.next_slide()  # ← pause: press Space/→ in the preview to continue

        circle = Circle(color=BLUE, radius=1.5).shift(DOWN * 0.5)
        self.play(title.animate.to_edge(UP), Create(circle))
        self.next_slide()

        square = Square(color=RED, side_length=3).shift(DOWN * 0.5)
        self.play(Transform(circle, square))
        self.next_slide()

        eq = MathTex(r"e^{i\pi} + 1 = 0", font_size=64).shift(DOWN * 0.5)
        self.play(FadeOut(circle), Write(eq))
        self.next_slide()

        self.play(FadeOut(eq), Unwrite(title))
