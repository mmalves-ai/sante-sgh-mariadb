<script setup lang="ts">
// 02-REC linha 34: manutenção dos locais de atendimento (consultórios e salas) numa tela só. A lista à esquerda e,
// no local escolhido, a semana de funcionamento (grade inteira gravada de uma vez, com a regra do domínio validando
// na hora), os locais para onde ele encaminha, os locais que ele consulta e quem o opera ou atende nele. A recusa do
// servidor aparece no próprio painel.
import { localAberto, validarHorarioLocal } from '@sgh/dominio-atendimento';
import { SanteBotao, SanteCampoTexto, SanteChave, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { novaChave } from '../../agenda/api-agenda.js';
import {
  type AcaoLocal,
  buscarUsuariosLocal,
  type FaixaLocal,
  lerLocaisAtendimento,
  manterLocalAtendimento,
} from '../api-locais-atendimento.js';

const props = defineProps<{ podeEditar: boolean }>();
const { t } = useI18n();
const qc = useQueryClient();
const CHAVE = ['adm', 'locais-atendimento'];
const dados = useQuery({ queryKey: CHAVE, queryFn: lerLocaisAtendimento });
const erro = ref<unknown>(null);
const mensagem = ref('');
const escolhido = ref('');
const local = computed(() => dados.data.value?.locais.find((l) => String(l.id) === escolhido.value) ?? null);
const outros = computed(() =>
  (dados.data.value?.locais ?? []).filter((l) => l.id !== local.value?.id && l.ativo),
);
const opcoesLocais = computed(() => [
  { valor: '', rotulo: t('locaisAtendimento.nenhum') },
  ...(dados.data.value?.locais ?? []).map((l) => ({
    valor: String(l.id),
    rotulo: `${l.codigo} · ${l.descricao}${l.ativo ? '' : ` ${t('locaisAtendimento.inativo')}`}`,
  })),
]);

async function gravar(a: AcaoLocal): Promise<number | null> {
  erro.value = null;
  mensagem.value = '';
  try {
    const r = await manterLocalAtendimento(a, novaChave('locais'));
    mensagem.value = r.mensagem ?? '';
    await qc.invalidateQueries({ queryKey: CHAVE });
    return r.resultado.local;
  } catch (e) {
    erro.value = e;
    return null;
  }
}

// ── Inclusão ──
const novo = ref({ codigo: '', descricao: '', recepcao: '', modulo: '', encaminha: false });
const opcoesRecepcao = computed(() => [
  { valor: '', rotulo: t('locaisAtendimento.nenhum') },
  ...(dados.data.value?.recepcoes ?? []).map((r) => ({ valor: String(r.id), rotulo: r.descricao })),
]);
const opcoesModulo = computed(() => [
  { valor: '', rotulo: t('locaisAtendimento.nenhum') },
  ...(dados.data.value?.modulos ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);
async function incluir() {
  const id = await gravar({
    acao: 'incluir',
    codigo: novo.value.codigo.trim(),
    descricao: novo.value.descricao.trim(),
    recepcao: Number(novo.value.recepcao),
    permiteEncaminhamento: novo.value.encaminha,
    moduloRecepcao: novo.value.modulo ? Number(novo.value.modulo) : null,
  });
  if (id) {
    novo.value = { codigo: '', descricao: '', recepcao: '', modulo: '', encaminha: false };
    escolhido.value = String(id);
  }
}

// ── Rascunho do local escolhido ──
const descricao = ref('');
const encaminha = ref(false);
const modulo = ref('');
const ativo = ref(true);
const faixas = ref<{ dia: string; inicio: string; fim: string }[]>([]);
const destinos = ref<number[]>([]);
const consultados = ref<number[]>([]);
const usuarios = ref<{ usuario: number; rotulo: string; atuaNoLocal: boolean; podeOperar: boolean }[]>([]);
watch(
  local,
  (l) => {
    if (!l) return;
    descricao.value = l.descricao;
    encaminha.value = l.permiteEncaminhamento;
    modulo.value = l.moduloRecepcao === null ? '' : String(l.moduloRecepcao);
    ativo.value = l.ativo;
    faixas.value = l.horario.map((f) => ({
      dia: f.diaNaoUtil ? 'nu' : String(f.diaSemana),
      inicio: f.inicio,
      fim: f.fim,
    }));
    destinos.value = [...l.encaminhaPara];
    consultados.value = [...l.consulta];
    usuarios.value = l.usuarios.map((u) => ({ ...u, rotulo: `${u.nome} (${u.login})` }));
  },
  { immediate: true },
);

const opcoesDia = computed(() => [
  ...[1, 2, 3, 4, 5, 6, 7].map((d) => ({
    valor: String(d),
    rotulo: t(`locaisAtendimento.horario.dias.d${d}`),
  })),
  { valor: 'nu', rotulo: t('locaisAtendimento.horario.naoUtil') },
]);
const semana = computed<FaixaLocal[]>(() =>
  faixas.value.map((f) => ({
    diaSemana: f.dia === 'nu' ? null : Number(f.dia),
    diaNaoUtil: f.dia === 'nu',
    inicio: f.inicio.trim(),
    fim: f.fim.trim(),
  })),
);
// Validação na hora, pela mesma regra do domínio que o servidor aplica.
const recusaHorario = computed(() => {
  const r = validarHorarioLocal(semana.value);
  return 'recusa' in r ? r.recusa.mensagem : '';
});
const agora = new Date();
const abertoAgora = computed(() =>
  recusaHorario.value
    ? null
    : localAberto(
        semana.value,
        agora.getDay() + 1,
        false,
        `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`,
      ),
);

const alternar = (lista: number[], id: number) =>
  lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id];

// ── Usuários ──
const termo = ref('');
const candidato = ref('');
const candidatos = ref<{ usuario: number; login: string; nome: string }[]>([]);
let pedido = 0;
watch(termo, async (v) => {
  const meu = ++pedido;
  if (v.trim().length < 2) return void (candidatos.value = []);
  try {
    const r = await buscarUsuariosLocal(v.trim());
    if (meu === pedido) candidatos.value = r;
  } catch (e) {
    erro.value = e;
  }
});
const opcoesCandidatos = computed(() => [
  { valor: '', rotulo: t('locaisAtendimento.nenhum') },
  ...candidatos.value
    .filter((c) => !usuarios.value.some((u) => u.usuario === c.usuario))
    .map((c) => ({ valor: String(c.usuario), rotulo: `${c.nome} (${c.login})` })),
]);
function incluirUsuario() {
  const c = candidatos.value.find((x) => String(x.usuario) === candidato.value);
  if (!c) return;
  usuarios.value = [
    ...usuarios.value,
    { usuario: c.usuario, rotulo: `${c.nome} (${c.login})`, atuaNoLocal: true, podeOperar: true },
  ];
  candidato.value = '';
  termo.value = '';
}
const usuarioSemPapel = computed(() => usuarios.value.some((u) => !u.atuaNoLocal && !u.podeOperar));
</script>

<template>
  <section class="painel" aria-labelledby="locais-atendimento-titulo" data-testid="locais-atendimento">
    <h2 id="locais-atendimento-titulo">{{ t('locaisAtendimento.titulo') }}</h2>
    <p v-if="dados.isPending.value">{{ t('locaisAtendimento.carregando') }}</p>
    <template v-else-if="dados.data.value">
      <form v-if="props.podeEditar" class="filtros" data-testid="local-novo" @submit.prevent="incluir">
        <SanteCampoTexto v-model="novo.codigo" :rotulo="t('locaisAtendimento.novo.codigo')" :max-bytes="30" />
        <SanteCampoTexto
          v-model="novo.descricao"
          :rotulo="t('locaisAtendimento.novo.descricao')"
          :max-bytes="150"
        />
        <SanteSelecao
          v-model="novo.recepcao"
          :rotulo="t('locaisAtendimento.novo.recepcao')"
          :opcoes="opcoesRecepcao"
        />
        <SanteSelecao
          v-model="novo.modulo"
          :rotulo="t('locaisAtendimento.novo.modulo')"
          :opcoes="opcoesModulo"
        />
        <SanteChave
          :ligada="novo.encaminha"
          :rotulo="t('locaisAtendimento.dados.encaminha')"
          data-testid="local-novo-encaminha"
          @alternar="(v: boolean) => (novo.encaminha = v)"
        />
        <SanteBotao
          tipo="submit"
          :rotulo="t('locaisAtendimento.novo.incluir')"
          :desabilitado="!novo.codigo.trim() || !novo.descricao.trim() || !novo.recepcao"
        />
      </form>

      <SanteSelecao
        v-model="escolhido"
        :rotulo="t('locaisAtendimento.local')"
        :opcoes="opcoesLocais"
        data-testid="local-escolhido"
      />

      <template v-if="local">
        <p data-testid="local-resumo">
          {{
            t('locaisAtendimento.resumo', {
              recepcao: local.recepcaoDescricao,
              faixas: local.horario.length,
              destinos: local.encaminhaPara.length,
              consultados: local.consulta.length,
              usuarios: local.usuarios.length,
            })
          }}
        </p>

        <fieldset :disabled="!props.podeEditar">
          <legend>{{ t('locaisAtendimento.dados.legenda') }}</legend>
          <SanteCampoTexto
            v-model="descricao"
            :rotulo="t('locaisAtendimento.dados.descricao')"
            :max-bytes="150"
          />
          <SanteSelecao
            v-model="modulo"
            :rotulo="t('locaisAtendimento.dados.modulo')"
            :opcoes="opcoesModulo"
            data-testid="local-modulo"
          />
          <SanteChave
            :ligada="encaminha"
            :rotulo="t('locaisAtendimento.dados.encaminha')"
            data-testid="local-encaminha"
            @alternar="(v: boolean) => (encaminha = v)"
          />
          <SanteChave
            :ligada="ativo"
            :rotulo="t('locaisAtendimento.dados.ativo')"
            data-testid="local-ativo"
            @alternar="(v: boolean) => (ativo = v)"
          />
          <SanteBotao
            v-if="props.podeEditar"
            :rotulo="t('locaisAtendimento.dados.gravar')"
            :desabilitado="!descricao.trim()"
            @acionar="
              gravar({
                acao: 'dados',
                local: local.id,
                descricao: descricao.trim(),
                permiteEncaminhamento: encaminha,
                ativo,
                moduloRecepcao: modulo ? Number(modulo) : null,
              })
            "
          />
        </fieldset>

        <fieldset :disabled="!props.podeEditar" data-testid="local-horario">
          <legend>{{ t('locaisAtendimento.horario.legenda') }}</legend>
          <div v-for="(f, i) in faixas" :key="i" class="filtros">
            <SanteSelecao
              v-model="f.dia"
              :rotulo="t('locaisAtendimento.horario.dia', { n: i + 1 })"
              :opcoes="opcoesDia"
            />
            <SanteCampoTexto
              v-model="f.inicio"
              :rotulo="t('locaisAtendimento.horario.inicio', { n: i + 1 })"
              :max-bytes="5"
            />
            <SanteCampoTexto
              v-model="f.fim"
              :rotulo="t('locaisAtendimento.horario.fim', { n: i + 1 })"
              :max-bytes="5"
            />
            <SanteBotao
              v-if="props.podeEditar"
              variante="secundario"
              :rotulo="t('locaisAtendimento.horario.retirar', { n: i + 1 })"
              @acionar="faixas = faixas.filter((_, j) => j !== i)"
            />
          </div>
          <p v-if="recusaHorario" role="alert" data-testid="local-horario-recusa">{{ recusaHorario }}</p>
          <p v-else-if="abertoAgora !== null" data-testid="local-aberto">
            {{ abertoAgora ? t('locaisAtendimento.horario.aberto') : t('locaisAtendimento.horario.fechado') }}
          </p>
          <template v-if="props.podeEditar">
            <SanteBotao
              variante="secundario"
              :rotulo="t('locaisAtendimento.horario.acrescentar')"
              @acionar="faixas = [...faixas, { dia: '2', inicio: '08:00', fim: '12:00' }]"
            />
            <SanteBotao
              :rotulo="t('locaisAtendimento.horario.gravar')"
              :desabilitado="!!recusaHorario"
              @acionar="gravar({ acao: 'horario', local: local.id, faixas: semana })"
            />
          </template>
        </fieldset>

        <fieldset :disabled="!props.podeEditar" data-testid="local-ligacoes">
          <legend>{{ t('locaisAtendimento.ligacoes.legenda') }}</legend>
          <p v-if="!local.permiteEncaminhamento" data-testid="local-nao-encaminha">
            {{ t('locaisAtendimento.ligacoes.naoEncaminha') }}
          </p>
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('locaisAtendimento.ligacoes.colunaLocal') }}</th>
                <th scope="col">{{ t('locaisAtendimento.ligacoes.colunaEncaminha') }}</th>
                <th scope="col">{{ t('locaisAtendimento.ligacoes.colunaConsulta') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in outros" :key="o.id">
                <td>{{ o.codigo }} · {{ o.descricao }}</td>
                <td>
                  <SanteChave
                    :ligada="destinos.includes(o.id)"
                    :rotulo="t('locaisAtendimento.ligacoes.encaminhaPara', { local: o.descricao })"
                    ocultar-rotulo
                    :data-testid="`local-destino-${o.id}`"
                    :desabilitada="!local.permiteEncaminhamento"
                    @alternar="destinos = alternar(destinos, o.id)"
                  />
                </td>
                <td>
                  <SanteChave
                    :ligada="consultados.includes(o.id)"
                    :rotulo="t('locaisAtendimento.ligacoes.consulta', { local: o.descricao })"
                    ocultar-rotulo
                    :data-testid="`local-consulta-${o.id}`"
                    @alternar="consultados = alternar(consultados, o.id)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <template v-if="props.podeEditar">
            <SanteBotao
              v-if="local.permiteEncaminhamento"
              :rotulo="t('locaisAtendimento.ligacoes.gravarEncaminhamentos')"
              @acionar="gravar({ acao: 'encaminhamentos', local: local.id, destinos })"
            />
            <SanteBotao
              :rotulo="t('locaisAtendimento.ligacoes.gravarConsultados')"
              @acionar="gravar({ acao: 'visibilidade', local: local.id, consultados })"
            />
          </template>
        </fieldset>

        <fieldset :disabled="!props.podeEditar" data-testid="local-usuarios">
          <legend>{{ t('locaisAtendimento.usuarios.legenda') }}</legend>
          <table class="tabela">
            <tbody>
              <tr v-for="u in usuarios" :key="u.usuario">
                <td>{{ u.rotulo }}</td>
                <td>
                  <SanteChave
                    :ligada="u.atuaNoLocal"
                    :rotulo="t('locaisAtendimento.usuarios.atende', { usuario: u.rotulo })"
                    :data-testid="`local-usuario-atende-${u.usuario}`"
                    @alternar="(v: boolean) => (u.atuaNoLocal = v)"
                  />
                </td>
                <td>
                  <SanteChave
                    :ligada="u.podeOperar"
                    :rotulo="t('locaisAtendimento.usuarios.opera', { usuario: u.rotulo })"
                    :data-testid="`local-usuario-opera-${u.usuario}`"
                    @alternar="(v: boolean) => (u.podeOperar = v)"
                  />
                </td>
                <td v-if="props.podeEditar">
                  <SanteBotao
                    variante="secundario"
                    :rotulo="t('locaisAtendimento.usuarios.retirar', { usuario: u.rotulo })"
                    @acionar="usuarios = usuarios.filter((x) => x.usuario !== u.usuario)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="usuarioSemPapel" role="alert" data-testid="local-usuario-sem-papel">
            {{ t('locaisAtendimento.usuarios.semPapel') }}
          </p>
          <div v-if="props.podeEditar" class="filtros">
            <SanteCampoTexto
              v-model="termo"
              :rotulo="t('locaisAtendimento.usuarios.buscar')"
              :max-bytes="60"
            />
            <SanteSelecao
              v-model="candidato"
              :rotulo="t('locaisAtendimento.usuarios.encontrado')"
              :opcoes="opcoesCandidatos"
              data-testid="local-usuario-candidato"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('locaisAtendimento.usuarios.acrescentar')"
              :desabilitado="!candidato"
              @acionar="incluirUsuario"
            />
            <SanteBotao
              :rotulo="t('locaisAtendimento.usuarios.gravar')"
              :desabilitado="usuarioSemPapel"
              @acionar="
                gravar({
                  acao: 'usuarios',
                  local: local.id,
                  usuarios: usuarios.map((u) => ({
                    usuario: u.usuario,
                    atuaNoLocal: u.atuaNoLocal,
                    podeOperar: u.podeOperar,
                  })),
                })
              "
            />
          </div>
        </fieldset>
      </template>
    </template>
    <p v-if="mensagem" role="status" data-testid="locais-atendimento-mensagem">{{ mensagem }}</p>
    <MensagemErro v-if="erro || dados.error.value" :erro="erro ?? dados.error.value" />
  </section>
</template>
