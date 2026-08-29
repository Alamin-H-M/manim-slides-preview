# ============================================================================
#  ALL-ANIMATIONS SHOWCASE for Manim Slides Preview
#  --------------------------------------------------------------------------
#  A stress-test / demo deck: every major Manim animation family, one slide
#  per category, ~20 interactive slides + a bonus 3D scene.
#
#  How to use with the extension:
#    1. Put this file in a folder, open the folder in VS Code.
#    2. Click the ▶ button (or Ctrl+Shift+B), pick "AllAnimations".
#    3. Step through slides in the browser with Space / arrow keys.
#    4. Edit anything, Ctrl+S -> watch the ⚡/🎬 progress log re-render 
#       ONLY what you touched (Output panel: "Manim Slides Preview").
#
#  Renders in draft (-ql) in a few minutes on a typical laptop.
# ============================================================================

import numpy as np
from manim import *
from manim_slides import Slide, ThreeDSlide


# ----------------------------------------------------------------------------
# Small helper mixin: keeps a section header at the top and a slide counter
# ----------------------------------------------------------------------------
class SectionMixin:
    def begin(self, title_text: str):
        """Transform the header into the next section title."""
        new_header = Text(title_text, font_size=34, color=YELLOW).to_edge(UP, buff=0.3)
        if getattr(self, "_header", None) is None:
            self._header = new_header
            self.play(FadeIn(self._header, shift=DOWN * 0.3))
        else:
            self.play(Transform(self._header, new_header))

    def clean(self, *keep):
        """Fade out everything except the header (and anything in *keep)."""
        keepset = {self._header, *keep}
        junk = [m for m in self.mobjects if m not in keepset]
        if junk:
            self.play(*[FadeOut(m) for m in junk])


class AllAnimations(SectionMixin, Slide):
    def construct(self):

        # ==================== SLIDE 1 — Title ====================
        title = Text("Manim Animation Showcase", font_size=52, gradient=(BLUE, TEAL))
        sub = Text("every animation family · one deck", font_size=26, color=GREY_A)
        sub.next_to(title, DOWN, buff=0.4)
        self.play(Write(title), run_time=1.5)
        self.play(FadeIn(sub, shift=UP * 0.3))
        self.next_slide(notes="Welcome! Advance with Space or the arrow keys.")

        self.play(FadeOut(title), FadeOut(sub))

        # ==================== SLIDE 2 — Creation family ====================
        self.begin("1 · Creation")
        sq, ci, tri = Square(color=BLUE), Circle(color=RED), Triangle(color=GREEN)
        row = VGroup(sq, ci, tri).arrange(RIGHT, buff=1.2).shift(UP * 0.6)
        star = Star(color=YELLOW, fill_opacity=0.8).scale(0.8).shift(DOWN * 1.6 + LEFT * 3)
        hexa = RegularPolygon(6, color=PURPLE, fill_opacity=0.6).scale(0.8).shift(DOWN * 1.6)
        arrow = Arrow(LEFT, RIGHT, color=ORANGE).shift(DOWN * 1.6 + RIGHT * 3)

        self.play(Create(sq))                       # stroke drawn over time
        self.play(DrawBorderThenFill(ci.set_fill(RED, 0.5)))
        self.play(SpiralIn(tri))                    # spiral into place
        self.play(GrowFromCenter(star))
        self.play(GrowFromEdge(hexa, DOWN))
        self.play(GrowArrow(arrow))
        self.next_slide(notes="Create, DrawBorderThenFill, SpiralIn, GrowFromCenter/Edge, GrowArrow")
        self.clean()

        # ==================== SLIDE 3 — Text writing ====================
        self.begin("2 · Text")
        t1 = Text("Write()", font_size=40).shift(UP * 0.8)
        t2 = Text("AddTextLetterByLetter()", font_size=36, color=TEAL)
        t3 = MarkupText('Markup: <b>bold</b> <i>italic</i> <span fgcolor="red">red</span>',
                        font_size=30).shift(DOWN * 1.2)
        self.play(Write(t1))
        self.play(AddTextLetterByLetter(t2), run_time=2)
        self.play(FadeIn(t3, shift=UP * 0.2))
        self.next_slide()
        self.play(Unwrite(t1), RemoveTextLetterByLetter(t2), FadeOut(t3))

        # ==================== SLIDE 4 — Fading family ====================
        self.begin("3 · Fading")
        dots = VGroup(*[Dot(radius=0.18, color=c) for c in
                        (RED, ORANGE, YELLOW, GREEN, TEAL, BLUE, PURPLE)])
        dots.arrange(RIGHT, buff=0.5)
        labels = VGroup(
            Text("shift", font_size=22), Text("scale", font_size=22),
            Text("target", font_size=22),
        ).arrange(RIGHT, buff=2.0).shift(DOWN * 1.8)
        self.play(FadeIn(dots, shift=DOWN, lag_ratio=0.1))
        self.play(FadeIn(labels[0]), FadeIn(labels[1]), FadeIn(labels[2]))
        self.next_slide()
        self.play(FadeOut(dots, shift=DOWN * 0.5, scale=0.3), FadeOut(labels))

        # ==================== SLIDE 5 — Transform family ====================
        self.begin("4 · Transform")
        a = Square(color=BLUE, fill_opacity=0.5).shift(LEFT * 4)
        b = Circle(color=RED, fill_opacity=0.5).shift(LEFT * 4)
        self.play(Create(a))
        self.play(Transform(a, b))                  # morph in place
        c = Triangle(color=GREEN, fill_opacity=0.5).shift(LEFT * 1.3)
        self.play(TransformFromCopy(a, c))          # copy morphs, original stays
        d = Star(color=YELLOW, fill_opacity=0.7).shift(RIGHT * 1.3)
        self.play(ReplacementTransform(c, d))       # original replaced
        e = RegularPolygon(6, color=PURPLE, fill_opacity=0.5).shift(RIGHT * 4)
        self.play(ClockwiseTransform(d.copy(), e))
        self.next_slide(notes="Transform, TransformFromCopy, ReplacementTransform, ClockwiseTransform")
        self.clean()

        # ==================== SLIDE 6 — Matching transforms ====================
        self.begin("5 · Matching shapes")
        w1 = Text("the morning star", font_size=44)
        w2 = Text("the evening star", font_size=44)
        self.play(Write(w1))
        self.next_slide()
        self.play(TransformMatchingShapes(w1, w2))  # letters fly to new spots
        self.next_slide()
        self.play(FadeOut(w2))

        # ==================== SLIDE 7 — .animate syntax ====================
        self.begin("6 · .animate")
        box = Square(color=TEAL, fill_opacity=0.6)
        self.play(Create(box))
        self.play(box.animate.shift(LEFT * 3))
        self.play(box.animate.scale(1.6).set_color(ORANGE))
        self.play(box.animate.rotate(PI / 4).shift(RIGHT * 6))
        self.play(box.animate.become(
            Circle(color=PINK, fill_opacity=0.6).shift(RIGHT * 3)))
        self.next_slide(notes="Any method chain works: shift/scale/rotate/set_color/become")
        self.clean()

        # ==================== SLIDE 8 — MoveToTarget / Restore ====================
        self.begin("7 · Target & Restore")
        pent = RegularPolygon(5, color=GREEN, fill_opacity=0.5)
        self.play(Create(pent))
        pent.save_state()
        pent.generate_target()
        pent.target.shift(RIGHT * 3.5).scale(0.5).set_color(RED).rotate(PI)
        self.play(MoveToTarget(pent))
        self.next_slide()
        self.play(Restore(pent))                    # snap back to saved state
        self.next_slide()
        self.play(FadeOut(pent))

        # ==================== SLIDE 9 — Function / matrix warps ====================
        self.begin("8 · Warps")
        grid_sq = Square(side_length=2.2, color=BLUE, fill_opacity=0.4).shift(LEFT * 3)
        self.play(Create(grid_sq))
        self.play(ApplyFunction(
            lambda m: m.scale(0.8).shift(RIGHT * 2).set_color(YELLOW), grid_sq))
        shear = Square(side_length=2.2, color=RED, fill_opacity=0.4).shift(RIGHT * 3)
        self.play(Create(shear))
        self.play(ApplyMatrix([[1, 0.6], [0.1, 1]], shear))     # shear matrix
        self.next_slide(notes="ApplyFunction and ApplyMatrix distort mobjects")
        self.clean()

        # ==================== SLIDE 10 — Indication family ====================
        self.begin("9 · Indication")
        items = VGroup(*[Text(w, font_size=30) for w in
                         ("Indicate", "Flash", "Wiggle", "FocusOn",
                          "Circumscribe", "ApplyWave")])
        items.arrange_in_grid(rows=2, buff=1.0).shift(DOWN * 0.4)
        self.play(FadeIn(items))
        self.play(Indicate(items[0]))
        self.play(Flash(items[1], color=YELLOW, flash_radius=0.9))
        self.play(Wiggle(items[2]))
        self.play(FocusOn(items[3]))
        self.play(Circumscribe(items[4], color=TEAL))
        self.play(ApplyWave(items[5]))
        self.next_slide(notes="Each word demos the indication named on it")
        self.clean()

        # ==================== SLIDE 11 — Movement & rotation ====================
        self.begin("10 · Movement")
        path = ParametricFunction(
            lambda t: np.array([3 * np.cos(t), 1.2 * np.sin(2 * t), 0]),
            t_range=[0, TAU], color=GREY_B)
        rider = Dot(color=YELLOW, radius=0.14)
        self.play(Create(path))
        self.play(MoveAlongPath(rider, path), run_time=3, rate_func=linear)
        windmill = VGroup(*[Line(ORIGIN, UP * 1.1, color=c)
                            for c in (RED, GREEN, BLUE, YELLOW)])
        for i, blade in enumerate(windmill):
            blade.rotate(i * PI / 2, about_point=ORIGIN)
        windmill.shift(DOWN * 1.8)
        self.play(FadeIn(windmill))
        self.play(Rotate(windmill, angle=TAU, about_point=windmill.get_center(),
                         run_time=2))
        self.next_slide(notes="MoveAlongPath on a Lissajous curve, Rotate on a windmill")
        self.clean()

        # ==================== SLIDE 12 — Looping slide ====================
        self.begin("11 · Looping slide  (this one loops!)")
        orbit = Circle(radius=1.6, color=GREY_B).shift(DOWN * 0.4)
        sun = Dot(color=YELLOW, radius=0.22).move_to(orbit.get_center())
        planet = Dot(color=BLUE, radius=0.12).move_to(orbit.point_at_angle(0))
        self.play(FadeIn(orbit), FadeIn(sun), FadeIn(planet))
        self.next_slide(loop=True, notes="loop=True: replays until you advance")
        self.play(MoveAlongPath(planet, orbit), run_time=2, rate_func=linear)
        self.next_slide()
        self.clean()

        # ==================== SLIDE 13 — ValueTracker / updaters ====================
        self.begin("12 · ValueTracker & updaters")
        tracker = ValueTracker(0)
        number = DecimalNumber(0, num_decimal_places=1, font_size=64, color=TEAL)
        number.add_updater(lambda m: m.set_value(tracker.get_value()))
        bar = always_redraw(lambda: Rectangle(
            width=max(tracker.get_value() / 20, 0.01), height=0.5,
            fill_color=TEAL, fill_opacity=0.8, stroke_width=0,
        ).align_to(LEFT * 5, LEFT).shift(DOWN * 1.2))
        number.shift(UP * 0.5)
        self.add(number, bar)
        self.play(tracker.animate.set_value(100), run_time=2.5, rate_func=smooth)
        self.play(tracker.animate.set_value(42), run_time=1.2)
        number.clear_updaters()
        self.next_slide(notes="DecimalNumber + always_redraw driven by a ValueTracker")
        self.clean()

        # ==================== SLIDE 14 — rate_func gallery ====================
        self.begin("13 · rate_func gallery")
        funcs = [("linear", linear), ("smooth", smooth),
                 ("rush_into", rush_into), ("there_and_back", there_and_back),
                 ("wiggle", wiggle)]
        racers = VGroup()
        for i, (name, _) in enumerate(funcs):
            d = Dot(color=interpolate_color(BLUE, RED, i / 4), radius=0.13)
            lab = Text(name, font_size=20).next_to(d, LEFT, buff=0.3)
            g = VGroup(d, lab).shift(UP * (1.4 - i * 0.8) + LEFT * 3)
            racers.add(g)
        self.play(FadeIn(racers))
        self.play(*[racers[i][0].animate(rate_func=f, run_time=2.5).shift(RIGHT * 6)
                    for i, (_, f) in enumerate(funcs)])
        self.next_slide(notes="Same shift, five different rate functions")
        self.clean()

        # ==================== SLIDE 15 — Composition ====================
        self.begin("14 · LaggedStart / Succession")
        grid = VGroup(*[Dot(radius=0.11, color=TEAL) for _ in range(30)])
        grid.arrange_in_grid(rows=3, buff=0.55).shift(UP * 0.4)
        self.play(LaggedStart(*[GrowFromCenter(d) for d in grid], lag_ratio=0.06))
        chain = VGroup(Square(0.7, color=RED), Circle(0.35, color=GREEN),
                       Triangle(color=BLUE).scale(0.5)).arrange(RIGHT, buff=1.4)
        chain.shift(DOWN * 1.8)
        self.play(Succession(*[Create(m) for m in chain]))
        self.next_slide(notes="LaggedStart ripples; Succession runs one-after-another")
        self.play(LaggedStart(*[FadeOut(d, scale=0.2) for d in grid], lag_ratio=0.04),
                  FadeOut(chain))

        # ==================== SLIDE 16 — Swap & CyclicReplace ====================
        self.begin("15 · Swap & CyclicReplace")
        s1 = Square(color=RED, fill_opacity=0.6).scale(0.7).shift(LEFT * 3)
        s2 = Circle(color=GREEN, fill_opacity=0.6).scale(0.7)
        s3 = Triangle(color=BLUE, fill_opacity=0.6).scale(0.7).shift(RIGHT * 3)
        self.play(FadeIn(s1), FadeIn(s2), FadeIn(s3))
        self.play(Swap(s1, s3))
        self.play(CyclicReplace(s1, s2, s3))
        self.next_slide()
        self.clean()

        # ==================== SLIDE 17 — Graphing ====================
        self.begin("16 · Graphs & areas")
        ax = Axes(x_range=[-1, 5, 1], y_range=[-1.5, 1.5, 1],
                  x_length=8, y_length=4,
                  axis_config={"include_tip": True}).shift(DOWN * 0.4)
        sine = ax.plot(lambda x: np.sin(x), color=TEAL)
        area = ax.get_area(sine, x_range=(0, PI), color=(BLUE, GREEN), opacity=0.5)
        dot_on = Dot(color=YELLOW).move_to(ax.c2p(0, 0))
        self.play(Create(ax), run_time=1.5)
        self.play(Create(sine), run_time=1.5)
        self.play(FadeIn(area))
        self.play(MoveAlongPath(dot_on, sine), run_time=2.5, rate_func=linear)
        self.next_slide(notes="Axes, plot, get_area, dot riding the curve")
        self.clean()

        # ==================== SLIDE 18 — LaTeX (needs TeX Live) ====================
        self.begin("17 · LaTeX")
        eq1 = MathTex("e^{i\\pi}", "+", "1", "=", "0", font_size=72)
        self.play(Write(eq1))
        self.next_slide()
        eq2 = MathTex("e^{i\\pi}", "=", "-", "1", font_size=72)
        self.play(TransformMatchingTex(eq1, eq2))   # terms fly to matches
        self.next_slide(notes="TransformMatchingTex keeps identical terms and moves them")
        self.play(FadeOut(eq2))

        # ==================== SLIDE 19 — Broadcast & passing flash ====================
        self.begin("18 · Broadcast & flashes")
        beacon = Dot(color=YELLOW, radius=0.15)
        self.play(FadeIn(beacon))
        self.play(Broadcast(Circle(radius=2.5, color=TEAL), focal_point=ORIGIN))
        outline = Square(side_length=3, color=YELLOW)
        self.play(ShowPassingFlash(outline.copy().set_stroke(width=8), time_width=0.4),
                  run_time=1.5)
        self.next_slide()
        self.clean()

        # ==================== SLIDE 20 — Finale ====================
        self.begin("19 · Finale")
        logo = VGroup(*[
            RegularPolygon(n, color=c, fill_opacity=0.55).scale(0.7)
            for n, c in zip(range(3, 9), (RED, ORANGE, YELLOW, GREEN, TEAL, PURPLE))
        ]).arrange_in_grid(rows=2, buff=0.7).shift(DOWN * 0.3)
        end = Text("fin.", font_size=60, color=WHITE).shift(DOWN * 0.3)
        self.play(LaggedStart(*[SpinInFromNothing(p) for p in logo], lag_ratio=0.12))
        self.next_slide()
        self.play(TransformMatchingShapes(logo, end))
        self.play(Circumscribe(end, color=YELLOW, fade_out=True))
        self.next_slide(notes="That's every major family. Press Space to wrap around.")
        self.play(FadeOut(end), FadeOut(self._header))


# ============================================================================
#  BONUS: 3D scene (render this class separately, or pick both in the picker)
# ============================================================================
class ThreeDShowcase(ThreeDSlide):
    def construct(self):
        self.set_camera_orientation(phi=70 * DEGREES, theta=-45 * DEGREES)
        axes = ThreeDAxes(x_range=[-4, 4], y_range=[-4, 4], z_range=[-3, 3])
        sphere = Sphere(radius=1.2, resolution=(18, 18)).set_color(BLUE_E)
        sphere.set_opacity(0.7)
        self.play(Create(axes), run_time=1.5)
        self.play(Create(sphere), run_time=1.5)
        self.next_slide(notes="A 3D slide — camera orbits next")

        self.begin_ambient_camera_rotation(rate=0.4)
        self.play(sphere.animate.scale(0.6).shift(OUT * 1.2), run_time=2)
        self.wait(2)
        self.stop_ambient_camera_rotation()
        self.next_slide(loop=True, notes="Looping torus spin")

        torus = Torus(major_radius=1.6, minor_radius=0.4).set_color(TEAL_E)
        torus.set_opacity(0.8)
        self.play(ReplacementTransform(sphere, torus))
        self.play(Rotate(torus, angle=TAU, axis=RIGHT, run_time=3, rate_func=linear))
        self.next_slide()
        self.play(FadeOut(torus), FadeOut(axes))
