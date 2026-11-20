// Identificação para a RNDS (M34; ficha, regra 14; referencias/08-regulatorio-2026-10.md, DP-47.5, 47.6 e 47.12): CPF
// como identificador principal (no SUS até 2026-12), CNS opcional (no pc, CNS em 8 de 47.063 pacientes e 0 de 871
// profissionais); o CNS é consultado pela RNDS (GET /api/fhir/r4/Patient; o barramento PDQ do DATASUS como
// alternativa) e o CNES pelo Organization ou webservice. Credenciamento no Portal de Serviços do DATASUS com
// certificado ICP-Brasil (e-CNPJ A1); token no ehr-auth com certificado de cliente; o EHR do RJ em
// rj-ehr-services.saude.gov.br. Fora de produção e até o deploy, só a homologação da RNDS — e, em dev e ci, só o
// simulador local (nenhuma chamada real fora de produção; regra 15).

/** CPF com os dígitos verificadores certos (11 dígitos, não todos iguais). */
export function cpfValido(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '');
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** CNS válido: definitivo (começa com 1 ou 2) ou provisório (7, 8 ou 9), pela soma ponderada módulo 11. */
export function cnsValido(cns: string): boolean {
  const d = cns.replace(/\D/g, '');
  if (!/^[12789]\d{14}$/.test(d)) return false;
  let soma = 0;
  for (let i = 0; i < 15; i++) soma += Number(d[i]) * (15 - i);
  return soma % 11 === 0;
}

export type IdentificacaoRnds =
  | { readonly tipo: 'cpf'; readonly valor: string; readonly cns: string | null }
  | { readonly tipo: 'cns'; readonly valor: string; readonly cns: string }
  | { readonly tipo: 'nenhuma'; readonly motivo: string };

/** O identificador principal para a RNDS: o CPF válido; sem ele, o CNS válido; sem os dois, não envia. */
export function identificacaoRnds(p: {
  readonly cpf: string | null;
  readonly cns: string | null;
}): IdentificacaoRnds {
  const cns = p.cns && cnsValido(p.cns) ? p.cns.replace(/\D/g, '') : null;
  if (p.cpf && cpfValido(p.cpf)) return { tipo: 'cpf', valor: p.cpf.replace(/\D/g, ''), cns };
  if (cns) return { tipo: 'cns', valor: cns, cns };
  return {
    tipo: 'nenhuma',
    motivo: 'Paciente sem CPF válido nem CNS válido: consulte o CNS na RNDS antes de enviar.',
  };
}

export type AmbienteRnds = 'producao' | 'homologacao' | 'simulador';

/** Ambiente da RNDS pelo ambiente do Sante SGH: produção só em produção; homologação até o deploy; dev/ci o simulador. */
export function ambienteRnds(ambiente: string, homologacaoAutorizada: boolean): AmbienteRnds {
  if (ambiente === 'producao') return 'producao';
  if ((ambiente === 'homolog' || ambiente === 'treino') && homologacaoAutorizada) return 'homologacao';
  return 'simulador';
}

/** Endereços da RNDS por ambiente (conferir no credenciamento; o do simulador vem da configuração local). */
export function enderecosRnds(
  a: AmbienteRnds,
  simulador: string | null,
): { autenticacao: string; ehr: string } {
  if (a === 'producao')
    return {
      autenticacao: 'https://ehr-auth.saude.gov.br/api/token',
      ehr: 'https://rj-ehr-services.saude.gov.br/api',
    };
  if (a === 'homologacao')
    return {
      autenticacao: 'https://ehr-auth-hmg.saude.gov.br/api/token',
      ehr: 'https://ehr-services.hmg.saude.gov.br/api',
    };
  if (!simulador)
    throw new Error('Simulador da RNDS não configurado (fora de produção nada vai à RNDS real).');
  const u = new URL(simulador);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
    throw new Error('O simulador da RNDS só em endereço local.');
  return { autenticacao: `${u.origin}/api/token`, ehr: `${u.origin}/api` };
}

/** Prazo do envio do registro de vacina (Portaria GM/MS 5.663/2024: até 24 h depois da aplicação). */
export function prazoEnvioVacina(aplicadaEm: Date): Date {
  return new Date(aplicadaEm.getTime() + 24 * 3_600_000);
}
