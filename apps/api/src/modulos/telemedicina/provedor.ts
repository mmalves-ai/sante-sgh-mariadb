// Provedor da sala de vídeo da teleconsulta (M50, etapa 4; ficha, seção 5: "sala do provedor (só em produção)"; seção
// 11: "provedor de teleconsulta no simulador ou desligado"). Fora de produção, só o SIMULADO
// (`TELECONSULTA_PROVEDOR_MODO` vazio ou `simulador`): a sala é um identificador aleatório e a tela mostra a sala
// simulada (nada sai da máquina, nenhum vídeo). O provedor real depende da autorização do dono (pré-requisito da chave
// `telemedicina`, POL-3): sem contrato e credenciais, o modo `desligado` (e a produção sem provedor) recusa abrir sala
// com 503. A conversa nunca é gravada pelo Sante; o endereço da sala nunca vai à trilha.
import { randomBytes } from 'node:crypto';
import type { SalaTeleconsulta } from '@sgh/contratos';

export interface ProvedorTeleconsulta {
  readonly tipo: 'simulado' | 'provedor';
  readonly disponivel: boolean;
  /** Cria a sala (uma por teleconsulta ou teleinterconsulta). */
  criarSala(referencia: string): Promise<{ sala: string }>;
  /** O endereço da sala para quem vai entrar (o médico ou o paciente). */
  endereco(sala: string, papel: 'medico' | 'paciente' | 'convidado'): string;
}

export class ProvedorSimulado implements ProvedorTeleconsulta {
  readonly tipo = 'simulado' as const;
  readonly disponivel = true;
  async criarSala(referencia: string) {
    // A referência só serve ao provedor real (o nome da sala lá); o simulado usa um identificador aleatório.
    void referencia;
    return { sala: `SIM-SALA-${randomBytes(8).toString('hex').toUpperCase()}` };
  }
  endereco(sala: string, papel: 'medico' | 'paciente' | 'convidado'): string {
    // A sala simulada é desenhada pela própria tela (nada sai da máquina).
    return `simulado:${sala}:${papel}`;
  }
}

/** Sem provedor (produção sem a autorização do dono, ou `TELECONSULTA_PROVEDOR_MODO=desligado`). */
export class ProvedorIndisponivel implements ProvedorTeleconsulta {
  readonly tipo = 'provedor' as const;
  readonly disponivel = false;
  async criarSala(): Promise<{ sala: string }> {
    throw new Error('Provedor de teleconsulta não configurado.');
  }
  endereco(): string {
    return '';
  }
}

export function provedorDoAmbiente(
  env: Record<string, string | undefined>,
  ambiente: string,
): ProvedorTeleconsulta {
  const modo = env['TELECONSULTA_PROVEDOR_MODO']?.trim() ?? '';
  if (ambiente === 'producao' || modo === 'desligado') return new ProvedorIndisponivel();
  return new ProvedorSimulado();
}

export function salaParaQuemVe(
  p: ProvedorTeleconsulta,
  t: { provedor: 'simulado' | 'provedor' | null; sala: string | null; salaAbertaEm: string | null },
  papel: 'medico' | 'paciente' | 'convidado',
): SalaTeleconsulta | null {
  if (!t.sala || !t.provedor || !t.salaAbertaEm) return null;
  return { provedor: t.provedor, endereco: p.endereco(t.sala, papel), abertaEm: t.salaAbertaEm };
}
