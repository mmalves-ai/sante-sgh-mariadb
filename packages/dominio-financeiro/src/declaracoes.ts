// Regra 18 do M32 (cap-06b §6.7, §6.8; cap-12 §12.1): DMED e EFD-REINF (R-2000 e R-4000) gerados como arquivo, sem
// envio, até a DP-38 ("gerado, não enviado"). O eSocial do autônomo está pronto e desligado (DP-10).
//   - DMED (prestador de serviço de saúde): RESPO, DECPJ, PSS (prestador) e RPPSS (recebimentos de pessoa física por CPF
//     do titular), FIMDmed; os valores por CPF são somados no arquivo e o total confere com as parcelas;
//   - EFD-REINF R-2010 (retenção de contribuição previdenciária dos serviços tomados) e R-4020 (pagamentos a pessoa
//     jurídica, IR/CSLL/PIS/COFINS), agrupados por prestador e competência.
import { centavos } from '@sgh/contratos/regras-financeiro';

export interface RecebimentoPf {
  /** CPF do titular (só dígitos; no arquivo, nunca na tela nem no log). */
  readonly cpfTitular: string;
  readonly nomeTitular: string;
  readonly valor: number;
}

export interface ArquivoDeclaracao {
  readonly conteudo: string;
  readonly registros: number;
  readonly valorTotal: number;
  readonly situacao: 'gerado-nao-enviado';
}

const so = (s: string) => s.replace(/\D/g, '');
const valor = (n: number) => String(Math.round(n * 100));

export function gerarDmed(
  ano: number,
  declarante: { cnpj: string; nome: string; responsavelCpf: string },
  recebimentos: readonly RecebimentoPf[],
): ArquivoDeclaracao {
  const porCpf = new Map<string, { nome: string; valor: number }>();
  for (const r of recebimentos) {
    const c = so(r.cpfTitular).padStart(11, '0');
    const x = porCpf.get(c) ?? { nome: r.nomeTitular, valor: 0 };
    x.valor = centavos(x.valor + r.valor);
    porCpf.set(c, x);
  }
  const linhas = [
    `DMED|${ano + 1}|${ano}|N||`,
    `RESPO|${so(declarante.responsavelCpf).padStart(11, '0')}|`,
    `DECPJ|${so(declarante.cnpj).padStart(14, '0')}|${declarante.nome.slice(0, 150)}|1|`,
    'PSS|',
    ...[...porCpf.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cpf, x]) => `RPPSS|${cpf}|${x.nome.slice(0, 150)}|${valor(x.valor)}|`),
    'FIMDmed|',
  ];
  const total = centavos([...porCpf.values()].reduce((s, x) => s + x.valor, 0));
  return {
    conteudo: `${linhas.join('\r\n')}\r\n`,
    registros: linhas.length,
    valorTotal: total,
    situacao: 'gerado-nao-enviado',
  };
}

export interface RetencaoServico {
  readonly cnpjPrestador: string;
  readonly documento: number;
  readonly dataEmissao: string;
  readonly valorBruto: number;
  /** INSS retido (R-2010). */
  readonly inss: number;
  /** IR, CSLL, PIS e COFINS retidos (R-4020). */
  readonly ir: number;
  readonly csll: number;
  readonly pis: number;
  readonly cofins: number;
}

function xmlEvento(evento: string, periodo: string, corpo: string): string {
  return `<Reinf><evt${evento} id="${evento}-${periodo}"><ideEvento><perApur>${periodo}</perApur><tpAmb>2</tpAmb></ideEvento>${corpo}</evt${evento}></Reinf>`;
}

/** R-2010 por prestador (série R-2000) e R-4020 por prestador (série R-4000) da competência AAAA-MM. */
export function gerarReinf(
  serie: 'R-2000' | 'R-4000',
  periodo: string,
  cnpjContribuinte: string,
  retencoes: readonly RetencaoServico[],
): ArquivoDeclaracao {
  const doMes = retencoes.filter((r) => r.dataEmissao.slice(0, 7) === periodo);
  const porPrestador = new Map<string, RetencaoServico[]>();
  for (const r of doMes)
    porPrestador.set(so(r.cnpjPrestador), [...(porPrestador.get(so(r.cnpjPrestador)) ?? []), r]);
  const eventos: string[] = [];
  let total = 0;
  for (const [cnpj, rs] of [...porPrestador.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const bruto = centavos(rs.reduce((s, r) => s + r.valorBruto, 0));
    if (serie === 'R-2000') {
      const inss = centavos(rs.reduce((s, r) => s + r.inss, 0));
      if (inss <= 0) continue;
      total = centavos(total + inss);
      eventos.push(
        xmlEvento(
          'ServTom',
          periodo,
          `<ideContri><nrInsc>${so(cnpjContribuinte)}</nrInsc></ideContri><idePrestServ><cnpjPrestador>${cnpj}</cnpjPrestador><vlrTotalBruto>${bruto.toFixed(2)}</vlrTotalBruto><vlrTotalRetPrinc>${inss.toFixed(2)}</vlrTotalRetPrinc><nfs>${rs.length}</nfs></idePrestServ>`,
        ),
      );
    } else {
      const ir = centavos(rs.reduce((s, r) => s + r.ir, 0));
      const csrf = centavos(rs.reduce((s, r) => s + r.csll + r.pis + r.cofins, 0));
      if (ir + csrf <= 0) continue;
      total = centavos(total + ir + csrf);
      eventos.push(
        xmlEvento(
          'RetPJ',
          periodo,
          `<ideContri><nrInsc>${so(cnpjContribuinte)}</nrInsc></ideContri><ideBenef><cnpjBenef>${cnpj}</cnpjBenef><vlrBruto>${bruto.toFixed(2)}</vlrBruto><vlrIR>${ir.toFixed(2)}</vlrIR><vlrCSRF>${csrf.toFixed(2)}</vlrCSRF></ideBenef>`,
        ),
      );
    }
  }
  return {
    conteudo: `<?xml version="1.0" encoding="UTF-8"?><loteEventos serie="${serie}" periodo="${periodo}">${eventos.join('')}</loteEventos>`,
    registros: eventos.length,
    valorTotal: total,
    situacao: 'gerado-nao-enviado',
  };
}
