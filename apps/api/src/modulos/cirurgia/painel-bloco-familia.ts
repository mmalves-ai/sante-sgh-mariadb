// Painel para familiares (M46, etapa 2; ficha, seção 7 e regra 5; cap-05a §5.5): a TV da sala de espera do bloco, pelo
// token do dispositivo (perfil Painel/Totem do M19, conteúdo "bloco"), mostra só o código anônimo, a etapa e o horário
// de cada paciente com código válido; nunca o nome, o procedimento, a sala nem o cirurgião. A saída do bloco fica
// visível por duas horas e some. Lê só tabelas do novo (os códigos do dia e a movimentação), com um cache de 0,5 s por
// estabelecimento: muitas TVs não multiplicam as consultas, e a propagação fica abaixo de 2 s (a tela relê a cada 1 s: no pior caso, 1,5 s).
import {
  ETAPAS_PAINEL_FAMILIA,
  type LinhaPainelFamilia,
  PAINEL_FAMILIA_SAIDA_VISIVEL_MIN,
} from '@sgh/contratos';
import { estadoDoRastreio, etapaDoPainel, rotuloEtapa, visivelNoPainel } from '@sgh/dominio-cirurgia';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import type { PortaBlocoSeguro } from './bloco-seguro-porta.js';
import type { PortaCirurgia } from './porta.js';

const CACHE_MS = 500;
const ORDEM = new Map(ETAPAS_PAINEL_FAMILIA.map((e, i) => [e.codigo, i]));

export class PainelBlocoFamilia {
  private readonly cache = new Map<
    string,
    { em: number; v: { agora: string; linhas: LinhaPainelFamilia[] } }
  >();

  constructor(
    private readonly porta: PortaBlocoSeguro,
    private readonly cirurgia: PortaCirurgia,
  ) {}

  async painel(c: ContextoPortaM18): Promise<{ agora: string; linhas: LinhaPainelFamilia[] }> {
    const k = `${c.cliente}:${c.estabelecimento}`;
    const x = this.cache.get(k);
    if (x && Date.now() - x.em < CACHE_MS) return x.v;
    const v = await this.montar(c);
    this.cache.set(k, { em: Date.now(), v });
    return v;
  }

  private async montar(c: ContextoPortaM18): Promise<{ agora: string; linhas: LinhaPainelFamilia[] }> {
    const r = await this.cirurgia.relogio(c);
    const agora = `${r.hoje}T${r.hhmm.slice(0, 2)}:${r.hhmm.slice(2, 4)}`;
    const codigos = await this.porta.codigos(c, agora);
    const ids = [...codigos.keys()];
    const movs = ids.length > 0 ? await this.porta.movimentosDe(c, ids) : new Map();
    const linhas: LinhaPainelFamilia[] = [];
    for (const [agendamento, cod] of codigos) {
      const e = estadoDoRastreio(movs.get(agendamento) ?? []);
      const etapa = etapaDoPainel(e);
      if (!etapa || !visivelNoPainel(e, agora, PAINEL_FAMILIA_SAIDA_VISIVEL_MIN)) continue;
      // Só o código, a etapa e o horário (regra 5): nada do agendamento entra na linha.
      linhas.push({
        codigo: cod.codigo,
        etapa,
        rotuloEtapa: rotuloEtapa(etapa),
        desde: (e.desde ?? '').slice(11, 16),
      });
    }
    linhas.sort(
      (a, b) => (ORDEM.get(a.etapa) ?? 9) - (ORDEM.get(b.etapa) ?? 9) || a.codigo.localeCompare(b.codigo),
    );
    return { agora, linhas };
  }
}
