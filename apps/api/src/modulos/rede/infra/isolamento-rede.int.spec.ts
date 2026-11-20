// Integração do isolamento da Rede na cópia (M57, etapa 1; regra 12; ARQ-1 e ARQ-2): o serviço do MPI sobre a porta do
// núcleo (só leitura aqui) opera só sobre os estabelecimentos da rede da sessão, lidos da lista configurada:
//   - consulta sem o código da rede, com a rede de outra hospedagem, com par ou filtro de estabelecimento fora da rede:
//     recusadas ANTES de qualquer leitura no banco (nenhuma chamada à porta);
//   - com a rede certa, a fila lê o índice do banco da sessão, e a lista de estabelecimentos é a configurada (HS-1: hoje
//     só o do catálogo), nunca uma lista fixa de dois hospitais.
// Nada é gravado; nenhum dado de pessoa sai (só contagens e códigos).
import { CATALOGO_LEGADO_ORIGEM } from '@sgh/contratos/catalogo-legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, NA_COPIA } from '../../acesso/aplicacao/copia.spec-util.js';
import { ServicoMpiRede, type SessaoRede } from '../aplicacao/servico.js';
import { portaRedeLegado } from '../porta-legado.js';
import { METODOS_PORTA_REDE, type PortaRede } from '../porta.js';

function sessao(rede: string, hospital: string): SessaoRede {
  return {
    rede,
    hospital,
    login: 'SGH.TESTE.M57',
    trilha: () => {
      throw new Error('Nenhuma gravação neste teste.');
    },
  };
}

describe.skipIf(!NA_COPIA)('isolamento da Rede na cópia (só leitura)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('sem rede, outra rede ou fora da rede: recusado antes de ler; com a rede, a fila do banco da sessão', async () => {
    const base = portaRedeLegado(a.nucleo, new Set([CATALOGO_LEGADO_ORIGEM.estabelecimento]));
    let leituras = 0;
    const porta = { ...base } as PortaRede;
    for (const m of METODOS_PORTA_REDE) {
      const f = base[m] as (...x: unknown[]) => Promise<unknown>;
      (porta as unknown as Record<string, unknown>)[m] = (...x: unknown[]) => {
        leituras++;
        return f(...x);
      };
    }
    const servico = new ServicoMpiRede(porta);
    const cod = a.cod;
    const fila = { situacao: 'aberto' as const, pagina: 1, porPagina: 20 };
    const codigo = async (p: Promise<unknown>) => {
      try {
        await p;
        return 'aceito';
      } catch (e) {
        return (
          (e as { extras?: { codigo?: string } }).extras?.codigo ?? (e as { tipo?: string }).tipo ?? 'erro'
        );
      }
    };
    expect(await codigo(servico.fila(sessao('', cod), fila))).toBe('rede-ausente');
    expect(await codigo(servico.fila(sessao('outra-rede-qualquer', cod), fila))).toBe('rede-diferente');
    expect(await codigo(servico.fila(sessao(a.c.rede, 'zz'), fila))).toBe('fora-da-rede');
    expect(await codigo(servico.fila(sessao(a.c.rede, cod), { ...fila, outroEstabelecimento: 'zz' }))).toBe(
      'fora-da-rede',
    );
    expect(await codigo(servico.candidato(sessao(a.c.rede, cod), `${cod}:1|zz:1`))).toBe('fora-da-rede');
    expect(await codigo(servico.vinculosDoCadastro(sessao(a.c.rede, cod), 'zz', 1))).toBe('fora-da-rede');
    expect(await codigo(servico.ciclo(sessao('', cod)))).toBe('rede-ausente');
    expect(await codigo(servico.divergencias(sessao('outra-rede-qualquer', cod)))).toBe('rede-diferente');
    expect(leituras).toBe(0);

    const f = await servico.fila(sessao(a.c.rede, cod), fila);
    expect(f.estabelecimentos.map((e) => e.codigo)).toEqual([cod]);
    expect(f.total).toBeGreaterThanOrEqual(0);
    expect(leituras).toBeGreaterThan(0);
    const d = await servico.divergencias(sessao(a.c.rede, cod));
    expect(d.estabelecimentos).toEqual([cod]);
  }, 300_000);
});
