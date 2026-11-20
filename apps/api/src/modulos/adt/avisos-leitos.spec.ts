// Tempo real do mapa e da higienização (M21; ficha, seção 10): o canal de eventos assina o canal "leitos" do vigia do
// M16 (o mesmo que vê a admissão gravada pelo outro sistema em 1 a 2 s); o primeiro ouvinte liga, o último desliga, e
// a gravação do novo avisa todos. Reconectar é assinar de novo: a versão segue e a tela relê tudo (nada se perde).
import { describe, expect, it } from 'vitest';
import { AvisosAtendimento } from '../atendimento/avisos.js';

describe('avisos do mapa de leitos', () => {
  it('assina o canal "leitos" do vigia, avisa a mudança vista pelo vigia e a gravação; reconexão segue a versão', () => {
    const assinados: string[] = [];
    let disparar: () => void = () => undefined;
    let cancelados = 0;
    const vigia = {
      assinar: (_h: string, canal: string, f: () => void) => {
        assinados.push(canal);
        disparar = f;
        return () => void cancelados++;
      },
    };
    const avisos = new AvisosAtendimento(vigia as never, 'leitos');
    const vistos: number[] = [];
    const sair = avisos.assinar('pc', (v) => vistos.push(v));
    expect(assinados).toEqual(['leitos']);
    disparar(); // o vigia viu a admissão gravada pelo outro sistema
    avisos.avisar('pc'); // a gravação do novo
    sair();
    expect(cancelados).toBe(1);
    const sair2 = avisos.assinar('pc', (v) => vistos.push(v)); // reconexão
    avisos.avisar('pc');
    sair2();
    expect(vistos).toEqual([1, 2, 3]);
    expect(assinados).toEqual(['leitos', 'leitos']);
  });
});
