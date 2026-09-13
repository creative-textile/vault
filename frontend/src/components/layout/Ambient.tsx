/**
 * Фоновая атмосфера приложения: три медленно дрейфующих цветных пятна
 * («северное сияние»), тонкая сетка хранилища и виньетка.
 *
 * Зачем: прежний фон был плоским `linear-gradient(#0a0a1a, #1a0a2e)`, из-за чего
 * даже хорошие карточки выглядели наклейками на пустом листе. Глубина фона —
 * самое дешёвое средство «дорогого» вида: анимируются только transform/opacity,
 * слои живут на GPU и не трогают layout, поэтому на iPhone SE это бесплатно.
 *
 * Компонент монтируется один раз в App и не перерисовывается (нет props/state).
 */
export default function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient__aurora ambient__aurora--1" />
      <div className="ambient__aurora ambient__aurora--2" />
      <div className="ambient__aurora ambient__aurora--3" />
      <div className="ambient__grid" />
      <div className="ambient__vignette" />
    </div>
  );
}
