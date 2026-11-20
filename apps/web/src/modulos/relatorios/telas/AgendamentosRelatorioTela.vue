<script setup lang="ts">
// Envio agendado de relatório por e-mail (M34; ficha, seção 7 e regra 5): `/relatorios/agendamentos`. Os envios (o
// relatório, os parâmetros fixos ou relativos ao dia do envio, os grupos e os endereços, a periodicidade e a hora; o
// próximo e o último envio, as falhas seguidas), criar, desativar e "enviar agora" (`relatorio.agendamento.editar`);
// o e-mail leva só o link. O histórico dos envios anteriores só em contagens por ano e situação.
// W0-09: Alterar (o mesmo formulário, com o motivo; os endereços gravados só aparecem mascarados e ficam, salvo se
// redigitados), desativar com motivo, excluir só o envio que nunca rodou (o que já rodou: 409 e a oferta de
// desativar) e o histórico. Fora de produção nada sai (SEM_ENVIO_NO_DEV): o aviso de desligado continua na tela.
import {
  type AgendamentoLido,
  DATAS_RELATIVAS,
  MESES_RELATIVOS,
  PERIODICIDADES,
  type RelatorioDescrito,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import {
  alterarAgendamento,
  ativarAgendamento,
  codigoDaRecusa,
  criarAgendamento,
  enviarAgora,
  excluirAgendamento,
  lerAgendamentos,
  lerCatalogo,
  lerHistoricoAgendamento,
  novaChave,
} from '../api-relatorios.js';
import AcaoComMotivo from '../componentes/AcaoComMotivo.vue';
import RecusaVinculos from '../componentes/RecusaVinculos.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const podeEditar = pode('relatorio.agendamento.editar');
const lista = useQuery({ queryKey: ['relatorios', 'agendamentos'], queryFn: () => lerAgendamentos() });
const catalogo = useQuery({ queryKey: ['relatorios', 'catalogo'], queryFn: () => lerCatalogo() });
const novo = reactive({
  relatorio: '',
  titulo: '',
  grupos: '',
  enderecos: '',
  periodicidade: 'diaria',
  hora: '07:00',
  diaSemana: '1',
  diaMes: '1',
});
const parametros = reactive<Record<string, string>>({});
// W0-09: o envio em alteração.
const editando = ref<AgendamentoLido | null>(null);
const relatorio = computed<RelatorioDescrito | null>(
  () => catalogo.data.value?.find((r) => r.codigo === novo.relatorio) ?? null,
);
// Os parâmetros do relatório escolhido: os padrões dele, ou (no Alterar) os gravados no envio. W0-09 revisão: o
// Alterar preenche direto, sem depender do watch, que não dispara quando o relatório do envio é o mesmo já escolhido
// (Alterar A e depois B do mesmo relatório, ou Alterar com um envio novo daquele relatório no formulário).
function preencherParametros(
  r: RelatorioDescrito | null,
  gravados: Record<string, string | number> | null,
): void {
  for (const k of Object.keys(parametros)) delete parametros[k];
  for (const p of r?.parametros ?? []) parametros[p.campo] = String(gravados?.[p.campo] ?? p.padrao ?? '');
}
/** Os parâmetros gravados valem só para o relatório do envio em alteração; fora disso, os padrões. */
const gravadosPara = (r: RelatorioDescrito | null) =>
  r && editando.value?.relatorio === r.codigo ? editando.value.parametros : null;
watch(relatorio, (r) => preencherParametros(r, gravadosPara(r)));
const manterEnderecos = ref(true);
const motivoEdicao = ref('');
const motivoCurto = ref(false);
let chaveEdicao: string | null = null;
function editar(a: AgendamentoLido): void {
  editando.value = a;
  Object.assign(novo, {
    relatorio: a.relatorio,
    titulo: a.titulo,
    grupos: a.grupos.join(', '),
    enderecos: '',
    periodicidade: a.periodicidade,
    hora: hora(a.hora),
    diaSemana: String(a.diaSemana ?? 1),
    diaMes: String(a.diaMes ?? 1),
  });
  // Os parâmetros gravados DESTE envio, já: se o relatório não mudou, o watch não dispara (se mudou, ele repete isto).
  preencherParametros(relatorio.value, gravadosPara(relatorio.value));
  manterEnderecos.value = true;
  motivoEdicao.value = '';
  motivoCurto.value = false;
  chaveEdicao = null;
  aviso.value = null;
}
function limparNovo(): void {
  editando.value = null;
  Object.assign(novo, {
    relatorio: '',
    titulo: '',
    grupos: '',
    enderecos: '',
    periodicidade: 'diaria',
    hora: '07:00',
    diaSemana: '1',
    diaMes: '1',
  });
}
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const lista2 = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

async function agendar(): Promise<void> {
  const r = relatorio.value;
  if (!r) return;
  erro.value = null;
  aviso.value = null;
  const p: Record<string, string | number> = {};
  for (const d of r.parametros) {
    const v = (parametros[d.campo] ?? '').trim();
    if (v !== '') p[d.campo] = d.tipo === 'inteiro' ? Number(v) : v;
  }
  const [hh, mm] = novo.hora.split(':').map(Number);
  const corpo = {
    relatorio: r.codigo,
    titulo: novo.titulo,
    parametros: p,
    grupos: lista2(novo.grupos),
    enderecos: lista2(novo.enderecos),
    periodicidade: novo.periodicidade,
    hora: (hh ?? 0) * 100 + (mm ?? 0),
    diaSemana: novo.periodicidade === 'semanal' ? Number(novo.diaSemana) : null,
    diaMes: novo.periodicidade === 'mensal' ? Number(novo.diaMes) : null,
  };
  try {
    if (editando.value) {
      if (motivoEdicao.value.trim().length < 5) {
        motivoCurto.value = true;
        return;
      }
      motivoCurto.value = false;
      chaveEdicao ??= novaChave('agendamento-alterar');
      await alterarAgendamento(
        editando.value.id,
        {
          ...corpo,
          ...(manterEnderecos.value ? { enderecos: [], manterEnderecos: true } : {}),
          motivo: motivoEdicao.value.trim(),
        },
        chaveEdicao,
      );
      chaveEdicao = null;
      aviso.value = t('relatorios.gestao.envioAlterado');
      limparNovo();
    } else {
      const c = await criarAgendamento(corpo);
      aviso.value = t('relatorios.agendamentos.agendado', {
        quando: c.proximoEnvio.slice(0, 16).replace('T', ' '),
      });
    }
    await cliente.invalidateQueries({ queryKey: ['relatorios', 'agendamentos'] });
  } catch (e) {
    erro.value = e;
  }
}

async function enviar(id: string): Promise<void> {
  erro.value = null;
  aviso.value = null;
  try {
    const r = await enviarAgora(id);
    aviso.value =
      r.situacao === 'enfileirado'
        ? t('relatorios.agendamentos.enfileirado')
        : t('relatorios.agendamentos.semFila');
  } catch (e) {
    erro.value = e;
  }
}

// Desativar, reativar (W0-09 revisão: volta a disparar o e-mail, fica no histórico com o motivo de quem reativou) e
// excluir pedem o motivo.
type AcaoEnvio = { tipo: 'desativar' | 'reativar' | 'excluir'; envio: AgendamentoLido };
const acao = ref<AcaoEnvio | null>(null);
const recusa = ref<{ erro: unknown; envio: AgendamentoLido } | null>(null);
const ocupado = ref(false);
let chaveAcao: string | null = null;
function iniciar(tipo: AcaoEnvio['tipo'], envio: AgendamentoLido): void {
  acao.value = { tipo, envio };
  recusa.value = null;
  erro.value = null;
  aviso.value = null;
  chaveAcao = null;
}
async function confirmarAcao(motivo: string): Promise<void> {
  const a = acao.value;
  if (!a) return;
  ocupado.value = true;
  erro.value = null;
  chaveAcao ??= novaChave(`agendamento-${a.tipo}`);
  try {
    if (a.tipo === 'excluir') await excluirAgendamento(a.envio.id, motivo, chaveAcao);
    else await ativarAgendamento(a.envio.id, a.tipo === 'reativar', motivo, chaveAcao);
    aviso.value = t(
      a.tipo === 'desativar'
        ? 'relatorios.gestao.envioDesativado'
        : a.tipo === 'reativar'
          ? 'relatorios.gestao.envioReativado'
          : 'relatorios.gestao.envioExcluido',
    );
    acao.value = null;
    chaveAcao = null;
    await cliente.invalidateQueries({ queryKey: ['relatorios', 'agendamentos'] });
  } catch (e) {
    chaveAcao = null;
    if (a.tipo === 'excluir' && codigoDaRecusa(e) === 'agendamento-ja-executado') {
      recusa.value = { erro: e, envio: a.envio };
      acao.value = null;
    } else erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const historicoDe = ref<AgendamentoLido | null>(null);
const historico = useQuery({
  queryKey: computed(() => ['relatorios', 'agendamentos', 'historico', historicoDe.value?.id]),
  queryFn: () => lerHistoricoAgendamento(historicoDe.value!.id),
  enabled: computed(() => historicoDe.value !== null),
});

const opRelatorios = computed(() => [
  { valor: '', rotulo: '—' },
  ...(catalogo.data.value ?? [])
    .filter((r) => r.podeExecutar)
    .map((r) => ({ valor: r.codigo, rotulo: r.titulo })),
]);
const opPeriodicidades = computed(() =>
  PERIODICIDADES.map((p) => ({ valor: p, rotulo: t(`relatorios.agendamentos.periodicidades.${p}`) })),
);
const opDias = computed(() =>
  [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    valor: String(n),
    rotulo: t(`relatorios.agendamentos.dias[${n - 1}]`),
  })),
);
const relativosDe = (tipo: string) =>
  (tipo === 'mes' ? MESES_RELATIVOS : tipo === 'data' ? DATAS_RELATIVAS : []).map((v) => ({
    valor: v as string,
    rotulo: t(`relatorios.agendamentos.relativos.${v}`),
  }));
const hora = (h: number) =>
  `${String(Math.floor(h / 100)).padStart(2, '0')}:${String(h % 100).padStart(2, '0')}`;
</script>

<template>
  <section class="tela-agenda" aria-labelledby="agenda-rel-titulo" data-testid="tela-agendamentos-relatorio">
    <h1 id="agenda-rel-titulo">{{ t('relatorios.agendamentos.titulo') }}</h1>
    <p>{{ t('relatorios.agendamentos.texto') }}</p>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('relatorios.carregando') }}</p>
    <template v-else>
      <div v-if="!lista.data.value.envioLigado" role="alert" data-testid="agendamento-desligado">
        <SanteAlerta
          variante="aviso"
          :texto="`${t('relatorios.agendamentos.desligado')}: ${lista.data.value.motivo ?? ''}`"
        />
      </div>
      <form
        v-if="podeEditar"
        class="painel formulario"
        aria-labelledby="novo-envio"
        data-testid="agendamento-novo"
        @submit.prevent="agendar"
      >
        <h2 id="novo-envio">
          {{
            editando
              ? t('relatorios.gestao.editarEnvio', { t: editando.titulo })
              : t('relatorios.agendamentos.novo')
          }}
        </h2>
        <SanteSelecao
          v-model="novo.relatorio"
          :rotulo="t('relatorios.agendamentos.relatorio')"
          :opcoes="opRelatorios"
          data-testid="agendamento-relatorio"
        />
        <SanteCampoTexto
          v-model="novo.titulo"
          :rotulo="t('relatorios.agendamentos.tituloEnvio')"
          :max-bytes="120"
          obrigatorio
          data-testid="agendamento-titulo"
        />
        <fieldset v-if="relatorio">
          <legend>{{ t('relatorios.agendamentos.parametros') }}</legend>
          <template v-for="p in relatorio.parametros" :key="p.campo">
            <SanteSelecao
              v-if="p.tipo === 'escolha'"
              :model-value="parametros[p.campo] ?? ''"
              @update:model-value="(v: string) => (parametros[p.campo] = v)"
              :rotulo="p.rotulo"
              :opcoes="(p.opcoes ?? []).map((o) => ({ valor: o.valor, rotulo: o.rotulo }))"
            />
            <SanteSelecao
              v-else-if="p.tipo === 'data' || p.tipo === 'mes'"
              :model-value="parametros[p.campo] ?? ''"
              @update:model-value="(v: string) => (parametros[p.campo] = v)"
              :rotulo="p.rotulo"
              :opcoes="relativosDe(p.tipo)"
              :data-testid="`agendamento-parametro-${p.campo}`"
            />
            <span v-else class="campo">
              <label :for="`ag-${p.campo}`">{{ p.rotulo }}</label>
              <input :id="`ag-${p.campo}`" v-model="parametros[p.campo]" type="number" />
            </span>
          </template>
        </fieldset>
        <span class="campo">
          <label for="ag-grupos">{{ t('relatorios.agendamentos.grupos') }}</label>
          <input id="ag-grupos" v-model="novo.grupos" maxlength="500" />
        </span>
        <div v-if="editando" class="campo" data-testid="agendamento-mascarados">
          <span>{{ t('relatorios.gestao.enderecosGravados') }}</span>
          <span v-if="editando.enderecosMascarados.length === 0" class="secundario">—</span>
          <ul v-else>
            <li v-for="e in editando.enderecosMascarados" :key="e">{{ e }}</li>
          </ul>
          <label class="marcar">
            <input v-model="manterEnderecos" type="checkbox" data-testid="agendamento-manter-enderecos" />
            {{ t('relatorios.gestao.manterEnderecos') }}
          </label>
        </div>
        <span v-if="!editando || !manterEnderecos" class="campo">
          <label for="ag-enderecos">{{
            editando ? t('relatorios.gestao.redigitarEnderecos') : t('relatorios.agendamentos.enderecos')
          }}</label>
          <input
            id="ag-enderecos"
            v-model="novo.enderecos"
            maxlength="1000"
            data-testid="agendamento-enderecos"
          />
        </span>
        <SanteSelecao
          v-model="novo.periodicidade"
          :rotulo="t('relatorios.agendamentos.periodicidade')"
          :opcoes="opPeriodicidades"
        />
        <span class="campo">
          <label for="ag-hora">{{ t('relatorios.agendamentos.hora') }}</label>
          <input id="ag-hora" v-model="novo.hora" type="time" required />
        </span>
        <SanteSelecao
          v-if="novo.periodicidade === 'semanal'"
          v-model="novo.diaSemana"
          :rotulo="t('relatorios.agendamentos.diaSemana')"
          :opcoes="opDias"
        />
        <span v-if="novo.periodicidade === 'mensal'" class="campo">
          <label for="ag-diames">{{ t('relatorios.agendamentos.diaMes') }}</label>
          <input id="ag-diames" v-model="novo.diaMes" type="number" min="1" max="28" />
        </span>
        <template v-if="editando">
          <SanteCampoTexto
            v-model="motivoEdicao"
            :rotulo="t('relatorios.gestao.motivo')"
            :max-bytes="200"
            obrigatorio
            data-testid="agendamento-motivo"
          />
          <p v-if="motivoCurto" class="erro" role="alert" data-testid="agendamento-motivo-curto">
            {{ t('relatorios.gestao.motivoCurto') }}
          </p>
        </template>
        <SanteBotao
          tipo="submit"
          :rotulo="editando ? t('relatorios.gravar') : t('relatorios.agendamentos.agendar')"
          data-testid="agendamento-agendar"
        />
        <SanteBotao
          v-if="editando"
          variante="texto"
          :rotulo="t('relatorios.gestao.desistir')"
          data-testid="agendamento-desistir"
          @acionar="limparNovo"
        />
      </form>
      <p v-if="aviso" role="status" data-testid="agendamento-aviso">{{ aviso }}</p>
      <MensagemErro v-if="erro" :erro="erro" />
      <AcaoComMotivo
        v-if="acao"
        :titulo="t(`relatorios.gestao.titulo.${acao.tipo}Envio`, { t: acao.envio.titulo })"
        :rotulo="t(`relatorios.gestao.${acao.tipo}`)"
        :destrutivo="acao.tipo === 'excluir'"
        :dica="t(`relatorios.gestao.dica.${acao.tipo}Envio`)"
        :ocupado="ocupado"
        @confirmar="confirmarAcao"
        @desistir="acao = null"
      />
      <RecusaVinculos
        v-if="recusa"
        :erro="recusa.erro"
        :oferta="t('relatorios.gestao.ofertaDesativar')"
        :sem-oferta="t('relatorios.gestao.envioJaDesativado')"
        @aceitar="iniciar('desativar', recusa.envio)"
      />
      <table class="tabela" data-testid="tabela-agendamentos">
        <caption>
          {{
            t('relatorios.agendamentos.lista')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('relatorios.agendamentos.tituloEnvio') }}</th>
            <th scope="col">{{ t('relatorios.agendamentos.relatorio') }}</th>
            <th scope="col">{{ t('relatorios.agendamentos.periodicidade') }}</th>
            <th scope="col">{{ t('relatorios.agendamentos.proximo') }}</th>
            <th scope="col">{{ t('relatorios.agendamentos.ultimo') }}</th>
            <th v-if="podeEditar" scope="col">{{ t('relatorios.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="lista.data.value.agendamentos.length === 0">
            <td :colspan="podeEditar ? 6 : 5">{{ t('relatorios.nenhum') }}</td>
          </tr>
          <tr v-for="a in lista.data.value.agendamentos" :key="a.id" :data-testid="`agendamento-${a.id}`">
            <td>
              {{ a.titulo }}
              <span class="secundario">{{
                a.ativo ? t('relatorios.agendamentos.ativo') : t('relatorios.agendamentos.inativo')
              }}</span>
            </td>
            <td>{{ a.relatorio }}</td>
            <td>{{ t(`relatorios.agendamentos.periodicidades.${a.periodicidade}`) }} · {{ hora(a.hora) }}</td>
            <td>{{ a.proximoEnvio?.slice(0, 16).replace('T', ' ') ?? '—' }}</td>
            <td>
              {{ a.ultimoEnvio?.slice(0, 16).replace('T', ' ') ?? '—' }}
              <span v-if="a.falhasSeguidas" class="secundario"
                >{{ t('relatorios.agendamentos.falhas', { n: a.falhasSeguidas }) }} {{ a.ultimaFalha }}</span
              >
            </td>
            <td v-if="podeEditar">
              <SanteBotao
                variante="secundario"
                :rotulo="t('relatorios.agendamentos.enviarAgora')"
                :desabilitado="!lista.data.value.envioLigado || !a.ativo"
                :data-testid="`agendamento-enviar-${a.id}`"
                @acionar="enviar(a.id)"
              />
              <SanteBotao
                variante="texto"
                :rotulo="t('relatorios.gestao.alterar')"
                :data-testid="`agendamento-alterar-${a.id}`"
                @acionar="editar(a)"
              />
              <SanteBotao
                v-if="a.ativo"
                variante="texto"
                :rotulo="t('relatorios.agendamentos.desativar')"
                :data-testid="`agendamento-desativar-${a.id}`"
                @acionar="iniciar('desativar', a)"
              />
              <SanteBotao
                v-else
                variante="texto"
                :rotulo="t('relatorios.agendamentos.ativar')"
                :data-testid="`agendamento-ativar-${a.id}`"
                @acionar="iniciar('reativar', a)"
              />
              <SanteBotao
                variante="texto"
                :rotulo="t('relatorios.gestao.excluir')"
                :data-testid="`agendamento-excluir-${a.id}`"
                @acionar="iniciar('excluir', a)"
              />
              <SanteBotao
                variante="texto"
                :rotulo="t('relatorios.gestao.historico')"
                :data-testid="`agendamento-historico-${a.id}`"
                @acionar="historicoDe = a"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <section
        v-if="historicoDe"
        class="painel"
        data-testid="agendamento-historico"
        aria-labelledby="ag-hist-titulo"
      >
        <h2 id="ag-hist-titulo">{{ t('relatorios.gestao.historicoDe', { t: historicoDe.titulo }) }}</h2>
        <MensagemErro v-if="historico.isError.value" :erro="historico.error.value" />
        <p v-else-if="!historico.data.value" role="status">{{ t('relatorios.carregando') }}</p>
        <p v-else-if="historico.data.value.length === 0">{{ t('relatorios.nenhum') }}</p>
        <ul v-else>
          <li v-for="(ev, i) in historico.data.value" :key="i">
            <strong>{{ t(`relatorios.gestao.eventos.${ev.evento}`) }}</strong> ·
            {{ ev.em.slice(0, 16).replace('T', ' ') }} · {{ ev.por }} · {{ ev.motivo }}
          </li>
        </ul>
        <SanteBotao variante="texto" :rotulo="t('relatorios.gestao.fechar')" @acionar="historicoDe = null" />
      </section>
      <section class="painel" aria-labelledby="origem-titulo" data-testid="agendamento-origem">
        <h2 id="origem-titulo">{{ t('relatorios.agendamentos.origem') }}</h2>
        <p>
          {{
            t('relatorios.agendamentos.origemTexto', {
              agendamentos: lista.data.value.origem.agendamentos,
              naoEnviados: lista.data.value.origem.naoEnviados,
              ultimo: lista.data.value.origem.ultimoEnviado?.split('-').reverse().join('/') ?? '—',
            })
          }}
        </p>
        <ul>
          <li v-for="x in lista.data.value.origem.porAno" :key="`${x.ano}-${x.situacao}`">
            {{ t('relatorios.agendamentos.porAno', x) }}
          </li>
        </ul>
        <details>
          <summary>{{ t('relatorios.agendamentos.origem') }}</summary>
          <GrupoDominiosTela subitem="envioAgendadoOrigem" embutida />
        </details>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.erro {
  color: var(--sgh-perigo-texto, var(--sgh-texto));
  font-weight: 600;
  margin: 0;
}
.marcar {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
}
</style>
