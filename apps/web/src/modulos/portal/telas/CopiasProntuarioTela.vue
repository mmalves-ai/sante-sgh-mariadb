<script setup lang="ts">
// Balcão da cópia do prontuário (W0-10, M2; LGPD art. 18 II e 19 II, CFM 1.821/2007). A fila dos pedidos de cópia
// (portal e balcão) com o prazo de 15 dias; para cada pedido: conferir quem pede (titular, representante com vínculo
// vigente ou familiar de falecido com a prova descrita), gerar o PDF com marca d'água (cada geração vai à trilha com o
// hash) e registrar a entrega. A legitimidade e a entrega pedem a senha de novo (reautenticação); toda ação passa por
// um painel de confirmação. Os atos são fatos novos: o pedido protocolado não se altera. Tela /portais/paciente/copias
// (o item do menu é pedido ao W4-01).
import type { AtoCopiaItem, CopiaNaFilaItem } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPortal from '../componentes/ErroPortal.vue';
import {
  atosDaCopia,
  conferirLegitimidadeCopia,
  entregarCopia,
  filaCopias,
  gerarCopia,
  pedirCopiaBalcao,
  responsaveisDoPaciente,
} from '../api-portal-interno.js';

type Acao = 'novo' | 'legitimidade' | 'gerar' | 'entregar';
const { t } = useI18n();
const T = 'portal.interno.copias';
const pendentes = ref(true);
const filtroPaciente = ref('');
const pacienteFiltro = computed(() =>
  /^\d+$/.test(filtroPaciente.value) ? Number(filtroPaciente.value) : null,
);
const consulta = useQuery({
  queryKey: computed(() => ['copias-prontuario', pendentes.value, pacienteFiltro.value]),
  queryFn: () => filaCopias(pendentes.value, pacienteFiltro.value),
});
const dia = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const quando = (s: string) => `${dia(s)} ${s.slice(11, 16)}`;

const historico = ref<{ protocolo: string; atos: AtoCopiaItem[] } | null>(null);
async function verAtos(c: CopiaNaFilaItem): Promise<void> {
  erro.value = null;
  try {
    historico.value = { protocolo: c.protocolo, atos: await atosDaCopia(c.protocolo) };
  } catch (x) {
    erro.value = x;
  }
}

const acao = ref<Acao | null>(null);
const alvo = ref<CopiaNaFilaItem | null>(null);
const paciente = ref('');
const solicitante = ref<'titular' | 'representante' | 'herdeiro'>('titular');
const vinculo = ref('');
const prova = ref('');
const observacao = ref('');
const meio = ref<'portal' | 'balcao' | 'correio'>('balcao');
const recebedor = ref('');
const senha = ref('');
const confirmando = ref(false);
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
const pdf = ref<{ url: string; nome: string } | null>(null);

const opcoesSolicitante = computed(() =>
  (['titular', 'representante', 'herdeiro'] as const).map((v) => ({
    valor: v,
    rotulo: t(`portal.copia.solicitantes.${v}`),
  })),
);
const opcoesMeio = computed(() =>
  (['portal', 'balcao', 'correio'] as const).map((v) => ({ valor: v, rotulo: t(`portal.copia.meios.${v}`) })),
);
const pacienteDoForm = computed(() => {
  if (acao.value === 'legitimidade') return alvo.value?.paciente ?? null;
  return /^\d+$/.test(paciente.value) ? Number(paciente.value) : null;
});
const vinculos = useQuery({
  queryKey: computed(() => ['copias-prontuario', 'vinculos', pacienteDoForm.value]),
  queryFn: () => responsaveisDoPaciente(pacienteDoForm.value ?? 0),
  enabled: computed(() => solicitante.value === 'representante' && pacienteDoForm.value !== null),
});
const opcoesVinculo = computed(() =>
  (vinculos.data.value ?? [])
    .filter((v) => v.situacao === 'ativo')
    .map((v) => ({ valor: v.vinculo, rotulo: `${v.primeiroNomeResponsavel} · ${v.tipo}` })),
);

function iniciar(a: Acao, c: CopiaNaFilaItem | null = null): void {
  acao.value = a;
  alvo.value = c;
  paciente.value = c ? String(c.paciente) : '';
  solicitante.value = c?.solicitante ?? 'titular';
  vinculo.value = c?.vinculo ?? '';
  prova.value = '';
  observacao.value = '';
  meio.value = 'balcao';
  recebedor.value = '';
  senha.value = '';
  confirmando.value = false;
  erro.value = null;
  feito.value = null;
}
function fechar(): void {
  acao.value = null;
  alvo.value = null;
  confirmando.value = false;
  senha.value = '';
}
const pedeSenha = computed(() => acao.value === 'legitimidade' || acao.value === 'entregar');
const pergunta = computed(() => {
  const p = alvo.value?.protocolo ?? '';
  const quem = t(`portal.copia.solicitantes.${solicitante.value}`);
  switch (acao.value) {
    case 'novo':
      return t(`${T}.perguntaNovo`, { paciente: paciente.value, solicitante: quem });
    case 'legitimidade':
      return t(`${T}.perguntaLegitimidade`, { solicitante: quem, protocolo: p });
    case 'gerar':
      return t(`${T}.perguntaGerar`, { protocolo: p });
    case 'entregar':
      return t(`${T}.perguntaEntregar`, { protocolo: p, meio: t(`portal.copia.meios.${meio.value}`) });
    default:
      return '';
  }
});
const rotuloAcao = computed(() =>
  acao.value === 'novo'
    ? t(`${T}.novo`)
    : acao.value === 'legitimidade'
      ? t(`${T}.legitimidade`)
      : acao.value === 'gerar'
        ? t(`${T}.gerar`)
        : t(`${T}.entregar`),
);
const nulo = (s: string) => s.trim() || null;

async function confirmar(): Promise<void> {
  const a = acao.value;
  const c = alvo.value;
  if (!a) return;
  erro.value = null;
  try {
    if (a === 'novo') {
      const r = await pedirCopiaBalcao({
        paciente: Number(paciente.value),
        solicitante: solicitante.value,
        vinculo: solicitante.value === 'representante' ? nulo(vinculo.value) : null,
        prova: nulo(prova.value),
        observacao: nulo(observacao.value),
      });
      feito.value = t(`${T}.feitoNovo`, { protocolo: r.protocolo });
    } else if (c && a === 'legitimidade') {
      await conferirLegitimidadeCopia(c.protocolo, {
        solicitante: solicitante.value,
        vinculo: solicitante.value === 'representante' ? nulo(vinculo.value) : null,
        prova: nulo(prova.value),
        senha: senha.value,
      });
      feito.value = t(`${T}.feitoLegitimidade`, { protocolo: c.protocolo });
    } else if (c && a === 'gerar') {
      const r = await gerarCopia(c.protocolo);
      if (pdf.value) URL.revokeObjectURL(pdf.value.url);
      pdf.value = { url: URL.createObjectURL(r.pdf), nome: `copia-prontuario-${c.protocolo}.pdf` };
      feito.value = t(`${T}.feitoGerar`, { paginas: r.paginas, hash: r.hash });
    } else if (c && a === 'entregar') {
      await entregarCopia(c.protocolo, {
        meio: meio.value,
        recebedor: nulo(recebedor.value),
        senha: senha.value,
      });
      feito.value = t(`${T}.feitoEntregar`, { protocolo: c.protocolo });
    }
    fechar();
    await consulta.refetch();
  } catch (x) {
    erro.value = x;
    confirmando.value = false;
  } finally {
    senha.value = '';
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="cop-titulo" data-testid="tela-copias-prontuario">
    <h1 id="cop-titulo">{{ t(`${T}.titulo`) }}</h1>
    <p>{{ t(`${T}.ajuda`) }}</p>
    <form class="cop-linha" @submit.prevent>
      <label class="cop-marca">
        <input v-model="pendentes" type="checkbox" data-testid="cop-pendentes" />
        {{ t(`${T}.pendentes`) }}
      </label>
      <SanteCampoTexto
        v-model="filtroPaciente"
        :rotulo="t(`${T}.paciente`)"
        :max-bytes="10"
        data-testid="cop-filtro-paciente"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t(`${T}.atualizar`)"
        data-testid="cop-atualizar"
        @acionar="consulta.refetch()"
      />
      <SanteBotao :rotulo="t(`${T}.novo`)" data-testid="cop-novo" @acionar="iniciar('novo')" />
    </form>
    <SanteAlerta v-if="feito" :texto="feito" variante="info" anunciar data-testid="cop-feito" />
    <p v-if="pdf">
      <a :href="pdf.url" :download="pdf.nome" data-testid="cop-pdf">{{ pdf.nome }}</a>
    </p>
    <ErroPortal v-if="erro" :erro="erro" />
    <ErroPortal v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="consulta.data.value">
      <p v-if="consulta.data.value.length === 0">{{ t('portal.nenhum') }}</p>
      <table v-else class="cop-tabela" data-testid="cop-fila">
        <caption>
          {{
            t(`${T}.titulo`)
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t(`${T}.protocolo`) }}</th>
            <th scope="col">{{ t(`${T}.pacienteColuna`) }}</th>
            <th scope="col">{{ t(`${T}.solicitante`) }}</th>
            <th scope="col">{{ t(`${T}.prazo`) }}</th>
            <th scope="col">{{ t(`${T}.etapa`) }}</th>
            <th scope="col">{{ t(`${T}.geracoes`) }}</th>
            <th scope="col">{{ t(`${T}.acoes`) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in consulta.data.value" :key="c.protocolo" :data-testid="`cop-linha-${c.protocolo}`">
            <td>{{ c.protocolo }} · {{ c.canal }}</td>
            <td>
              {{ c.paciente }}<template v-if="c.prontuario"> · {{ c.prontuario }}</template>
            </td>
            <td>{{ t(`portal.copia.solicitantes.${c.solicitante}`) }}</td>
            <td>
              {{ dia(c.prazo) }}<strong v-if="c.atrasado"> · {{ t(`${T}.atrasado`) }}</strong>
            </td>
            <td :data-testid="`cop-etapa-${c.protocolo}`">
              {{
                c.situacao === 'cancelado' || c.situacao === 'negado'
                  ? t(`portal.privacidade.situacoes.${c.situacao}`)
                  : t(`portal.copia.etapas.${c.etapa}`)
              }}
            </td>
            <td>{{ c.geracoes }}</td>
            <td class="cop-acoes">
              <SanteBotao
                variante="texto"
                :rotulo="t(`${T}.verAtos`)"
                :data-testid="`cop-atos-${c.protocolo}`"
                @acionar="verAtos(c)"
              />
              <template v-if="c.situacao !== 'cancelado' && c.situacao !== 'negado'">
                <SanteBotao
                  v-if="c.etapa === 'aguardando-conferencia'"
                  variante="texto"
                  :rotulo="t(`${T}.legitimidade`)"
                  :data-testid="`cop-legitimidade-${c.protocolo}`"
                  @acionar="iniciar('legitimidade', c)"
                />
                <SanteBotao
                  v-if="c.etapa === 'legitimidade-conferida' || c.etapa === 'gerada'"
                  variante="texto"
                  :rotulo="t(`${T}.gerar`)"
                  :data-testid="`cop-gerar-${c.protocolo}`"
                  @acionar="iniciar('gerar', c)"
                />
                <SanteBotao
                  v-if="c.etapa === 'gerada'"
                  variante="texto"
                  :rotulo="t(`${T}.entregar`)"
                  :data-testid="`cop-entregar-${c.protocolo}`"
                  @acionar="iniciar('entregar', c)"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <section v-if="historico" class="cop-historico" data-testid="cop-historico">
      <h2>{{ t(`${T}.historico`) }} · {{ historico.protocolo }}</h2>
      <ul>
        <li v-for="(a, i) in historico.atos" :key="i">
          {{ t(`${T}.ato`, { ato: t(`${T}.atos.${a.ato}`), quem: a.usuario, quando: quando(a.em) }) }}
          <template v-if="a.hash"> · {{ a.hash }}</template>
          <template v-if="a.meio"> · {{ t(`portal.copia.meios.${a.meio}`) }}</template>
        </li>
      </ul>
    </section>

    <form v-if="acao" class="form" data-testid="cop-form" @submit.prevent>
      <h2>
        {{ rotuloAcao }}<template v-if="alvo"> · {{ alvo.protocolo }}</template>
      </h2>
      <SanteCampoTexto
        v-if="acao === 'novo'"
        v-model="paciente"
        :rotulo="t(`${T}.codigoPaciente`)"
        :max-bytes="10"
        data-testid="cop-paciente"
      />
      <template v-if="acao === 'novo' || acao === 'legitimidade'">
        <SanteSelecao
          v-model="solicitante"
          :rotulo="t(`${T}.solicitante`)"
          :opcoes="opcoesSolicitante"
          data-testid="cop-solicitante"
        />
        <template v-if="solicitante === 'representante'">
          <SanteSelecao
            v-if="opcoesVinculo.length"
            v-model="vinculo"
            :rotulo="t(`${T}.vinculo`)"
            :opcoes="opcoesVinculo"
            data-testid="cop-vinculo"
          />
          <p v-else-if="pacienteDoForm !== null && vinculos.isSuccess.value">{{ t(`${T}.semVinculos`) }}</p>
        </template>
        <SanteCampoTexto v-model="prova" :rotulo="t(`${T}.prova`)" :max-bytes="200" data-testid="cop-prova" />
      </template>
      <SanteCampoTexto
        v-if="acao === 'novo'"
        v-model="observacao"
        :rotulo="t(`${T}.observacao`)"
        :max-bytes="500"
        multilinha
        data-testid="cop-observacao"
      />
      <template v-if="acao === 'entregar'">
        <SanteSelecao v-model="meio" :rotulo="t(`${T}.meio`)" :opcoes="opcoesMeio" data-testid="cop-meio" />
        <SanteCampoTexto
          v-model="recebedor"
          :rotulo="t(`${T}.recebedor`)"
          :max-bytes="120"
          data-testid="cop-recebedor"
        />
      </template>
      <span v-if="pedeSenha" class="campo">
        <label for="cop-senha">{{ t('portal.interno.senha') }}</label>
        <input
          id="cop-senha"
          v-model="senha"
          type="password"
          autocomplete="current-password"
          data-testid="cop-senha"
        />
      </span>
      <SanteAlerta v-if="confirmando" :texto="pergunta" variante="aviso" data-testid="cop-pergunta" />
      <div class="cop-linha">
        <SanteBotao
          :rotulo="confirmando ? t(`${T}.confirmar`) : t(`${T}.seguir`)"
          :data-testid="confirmando ? 'cop-confirmar' : 'cop-seguir'"
          @acionar="confirmando ? confirmar() : (confirmando = true)"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t(`${T}.cancelar`)"
          data-testid="cop-voltar"
          @acionar="fechar"
        />
      </div>
    </form>
  </section>
</template>

<style scoped>
.cop-tabela {
  border-collapse: collapse;
  width: 100%;
}
.cop-tabela th,
.cop-tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
.cop-linha,
.cop-acoes {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--sgh-espaco-2);
}
.cop-marca {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
}
.form,
.cop-historico {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-3);
}
.campo {
  display: flex;
  flex-direction: column;
}
</style>
