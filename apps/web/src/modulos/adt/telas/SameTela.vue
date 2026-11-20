<script setup lang="ts">
// Movimentação física de prontuários e contas (ficha do M21, seção 7): `/same/movimentos`. O leitor de código de barras
// lê a etiqueta da conta (manda o número e o Enter) ou a pessoa digita; a tela mostra onde o volume está (um lugar por
// vez), a linha do tempo e registra o movimento (registro, saída, devolução, descarte com o aval da comissão,
// transferência, recebimento). O movimento lançado por engano se desfaz (só o último; exclusão lógica com o motivo).
// O recebimento do que não foi enviado vira ocorrência (registrada aqui); a remessa recebida tem o aceite de quem
// recebe; os volumes fora do arquivo além do prazo aparecem na lista da cobrança, com o registro da cobrança.
import { OPERACOES_SAME } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../agenda/formato.js';
import {
  codigoDaRecusa,
  excluirMovimento,
  lerConta,
  lerDevolucoesAtrasadas,
  movimentar,
  novaChave,
  registrarSame,
} from '../api-adt.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import { codigoDaEtiqueta } from '../regras-tela.js';
import { usarAdt } from '../usar-adt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { apoio, pode, motivoDe } = usarAdt('same');
const podeMovimentar = pode('same.movimentarProntuario');
const podeDesfazer = pode('same.excluirMovimento');
const aviso = motivoDe('same.movimentarProntuario');
const lido = ref('');
const codigo = ref('');
const campo = ref<HTMLInputElement | null>(null);
onMounted(() => campo.value?.focus());
const conta = useQuery({
  queryKey: computed(() => ['adt', 'same', codigo.value]),
  queryFn: () => lerConta(codigo.value),
  enabled: computed(() => codigo.value !== ''),
});
function ler(): void {
  const c = codigoDaEtiqueta(lido.value);
  if (c) codigo.value = c;
  lido.value = '';
}
const COM_MOTIVO = [2, 4, 5];
const operacao = ref('2');
const origem = ref('');
const destino = ref('');
const responsavel = ref('');
const motivo = ref('');
const protocolo = ref('');
const prazo = ref('');
const aval = ref('');
const observacao = ref('');
const opcoes = computed(() => {
  const a = apoio.data.value;
  return {
    operacoes: OPERACOES_SAME.map((o) => ({ valor: String(o.codigo), rotulo: o.rotulo })),
    setores: [
      { valor: '', rotulo: t('adt.escolha') },
      ...(a?.setores ?? []).map((s) => ({ valor: String(s.codigo), rotulo: s.nome })),
    ],
    motivos: [
      { valor: '', rotulo: t('adt.escolha') },
      ...(a?.motivosSame ?? []).map((s) => ({ valor: String(s.codigo), rotulo: s.nome })),
    ],
  };
});
// A origem é onde o volume está (um lugar por vez); no registro, o setor do arquivo.
const origemSugerida = computed(() => String(conta.data.value?.local?.setor.codigo ?? ''));
const origemEfetiva = computed(() => origem.value || origemSugerida.value);
const completo = computed(
  () =>
    !!conta.data.value &&
    !!origemEfetiva.value &&
    !!destino.value &&
    responsavel.value.trim().length >= 3 &&
    (!COM_MOTIVO.includes(Number(operacao.value)) || !!motivo.value) &&
    (operacao.value !== '4' || aval.value.trim().length > 0),
);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
async function registrar(): Promise<void> {
  const c = conta.data.value;
  if (!c) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const op = Number(operacao.value);
    const r = await movimentar(
      {
        conta: c.conta,
        operacao: op,
        setorOrigem: Number(origemEfetiva.value),
        setorDestino: Number(destino.value),
        responsavel: responsavel.value.trim().toUpperCase(),
        ...(COM_MOTIVO.includes(op) && motivo.value ? { motivo: Number(motivo.value) } : {}),
        ...(protocolo.value.trim() ? { protocolo: protocolo.value.trim() } : {}),
        ...(prazo.value ? { prazoDevolucao: prazo.value } : {}),
        ...(op === 4 ? { avalComissao: aval.value.trim() } : {}),
        ...(observacao.value.trim() ? { observacao: observacao.value.trim() } : {}),
      },
      novaChave('same'),
    );
    mensagem.value = r.mensagem;
    origem.value = '';
    await cliente.invalidateQueries({ queryKey: ['adt', 'same'] });
    await nextTick();
    campo.value?.focus();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const motivoDesfazer = ref('');
async function desfazer(id: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (
      await excluirMovimento(id, { motivo: motivoDesfazer.value.trim() }, novaChave('desfazer'))
    ).mensagem;
    motivoDesfazer.value = '';
    await cliente.invalidateQueries({ queryKey: ['adt', 'same'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const ultimo = computed(() => conta.data.value?.linhaDoTempo.find((m) => !m.excluido) ?? null);

// ── Ocorrência, aceite e cobrança (só no novo) ──
const naoEnviado = computed(() => codigoDaRecusa(erro.value) === 'nao-enviado');
const textoOcorrencia = ref('');
const atrasadas = useQuery({
  queryKey: ['adt', 'same', 'atrasadas'],
  queryFn: () => lerDevolucoesAtrasadas(),
});
async function registrarExtra(corpo: Record<string, unknown>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (await registrarSame(corpo, novaChave(`same-${String(corpo['tipo'])}`))).mensagem;
    textoOcorrencia.value = '';
    await cliente.invalidateQueries({ queryKey: ['adt', 'same'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const ocorrencia = () => {
  const c = conta.data.value;
  if (c) void registrarExtra({ conta: c.conta, tipo: 'ocorrencia', motivo: textoOcorrencia.value.trim() });
};
const aceitar = (movimento: number) => {
  const c = conta.data.value;
  if (c) void registrarExtra({ conta: c.conta, tipo: 'aceite', movimento });
};
const cobrar = (contaId: number, movimento: number) =>
  registrarExtra({ conta: contaId, tipo: 'cobranca', movimento });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="same-titulo" data-testid="tela-same">
    <h1 id="same-titulo">{{ t('adt.same.titulo') }}</h1>
    <p>{{ t('adt.same.texto') }}</p>
    <AvisoAdt :motivo="aviso" />
    <form class="filtros" role="search" @submit.prevent="ler">
      <div class="campo">
        <label for="same-codigo">{{ t('adt.same.codigo') }}</label>
        <input
          id="same-codigo"
          ref="campo"
          v-model="lido"
          inputmode="numeric"
          autocomplete="off"
          data-testid="same-codigo"
        />
      </div>
      <SanteBotao tipo="submit" :rotulo="t('adt.same.ler')" data-testid="same-ler" />
    </form>
    <ErroAdt v-if="conta.isError.value" :erro="conta.error.value" />
    <template v-else-if="conta.data.value">
      <section class="painel" aria-labelledby="same-conta">
        <h2 id="same-conta">
          {{
            t('adt.same.conta', {
              n: conta.data.value.numero,
              tipo: t(`adt.same.tipos.${conta.data.value.tipo}`),
              atd: conta.data.value.atendimento,
            })
          }}
        </h2>
        <p>
          <strong>{{ conta.data.value.paciente }}</strong>
          <span class="secundario"> · {{ t('adt.prontuario', { n: conta.data.value.prontuario }) }}</span>
        </p>
        <p v-if="conta.data.value.local" data-testid="same-local">
          {{
            t('adt.same.local', {
              setor: conta.data.value.local.setor.nome,
              desde: conta.data.value.local.desde.replace('T', ' ').slice(0, 16),
              operacao: conta.data.value.local.operacao,
            })
          }}
        </p>
        <p v-else data-testid="same-sem-local">{{ t('adt.same.semLocal') }}</p>
        <SanteAlerta
          v-if="conta.data.value.devolucaoAtrasada"
          variante="aviso"
          :texto="t('adt.same.atrasada')"
        />
      </section>
      <section v-if="podeMovimentar" class="painel" aria-labelledby="same-mov">
        <h2 id="same-mov">{{ t('adt.same.registrar') }}</h2>
        <div class="filtros">
          <SanteSelecao
            v-model="operacao"
            :rotulo="t('adt.same.operacao')"
            :opcoes="opcoes.operacoes"
            data-testid="same-operacao"
          />
          <SanteSelecao
            :model-value="origemEfetiva"
            :rotulo="t('adt.same.origem')"
            :opcoes="opcoes.setores"
            data-testid="same-origem"
            @update:model-value="origem = String($event)"
          />
          <SanteSelecao
            v-model="destino"
            :rotulo="t('adt.same.destino')"
            :opcoes="opcoes.setores"
            data-testid="same-destino"
          />
          <SanteSelecao
            v-if="COM_MOTIVO.includes(Number(operacao))"
            v-model="motivo"
            :rotulo="t('adt.motivo')"
            :opcoes="opcoes.motivos"
            data-testid="same-motivo"
          />
        </div>
        <div class="filtros">
          <SanteCampoTexto
            v-model="responsavel"
            :rotulo="t('adt.same.responsavel')"
            :max-bytes="70"
            obrigatorio
            data-testid="same-responsavel"
          />
          <SanteCampoTexto v-model="protocolo" :rotulo="t('adt.same.protocolo')" :max-bytes="30" />
          <div class="campo">
            <label for="same-prazo">{{ t('adt.same.prazo') }}</label>
            <input id="same-prazo" v-model="prazo" type="date" />
          </div>
          <SanteCampoTexto
            v-if="operacao === '4'"
            v-model="aval"
            :rotulo="t('adt.same.aval')"
            :max-bytes="60"
            obrigatorio
          />
        </div>
        <SanteCampoTexto v-model="observacao" :rotulo="t('adt.observacao')" :max-bytes="400" />
        <SanteBotao
          :rotulo="t('adt.same.registrar')"
          :desabilitado="!completo || ocupado"
          data-testid="same-gravar"
          @acionar="registrar"
        />
      </section>
      <p v-if="mensagem" role="status" data-testid="same-mensagem">{{ mensagem }}</p>
      <ErroAdt v-if="erro" :erro="erro" />
      <section v-if="naoEnviado && podeMovimentar" class="painel" aria-labelledby="same-ocorrencia">
        <h2 id="same-ocorrencia">{{ t('adt.same.ocorrencia') }}</h2>
        <SanteCampoTexto
          v-model="textoOcorrencia"
          :rotulo="t('adt.same.ocorrenciaTexto')"
          :max-bytes="200"
          data-testid="same-ocorrencia-texto"
        />
        <SanteBotao
          :rotulo="t('adt.same.registrarOcorrencia')"
          :desabilitado="textoOcorrencia.trim().length < 5 || ocupado"
          data-testid="same-ocorrencia-gravar"
          @acionar="ocorrencia"
        />
      </section>
      <ul v-if="conta.data.value.ocorrencias?.length" class="lista-simples" data-testid="same-ocorrencias">
        <li v-for="(o, i) in conta.data.value.ocorrencias" :key="i">
          {{ t('adt.same.ocorrenciaDe', { em: o.em.replace('T', ' ').slice(0, 16), por: o.por }) }}:
          {{ o.motivo }}
        </li>
      </ul>
      <h2>{{ t('adt.same.linhaDoTempo') }}</h2>
      <table class="tabela" data-testid="tabela-same">
        <caption class="secundario">
          {{
            t('adt.same.linhaDoTempo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('adt.data') }}</th>
            <th scope="col">{{ t('adt.same.operacao') }}</th>
            <th scope="col">{{ t('adt.same.origem') }}</th>
            <th scope="col">{{ t('adt.same.destino') }}</th>
            <th scope="col">{{ t('adt.same.responsavel') }}</th>
            <th scope="col">{{ t('adt.acoesColuna') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="m in conta.data.value.linhaDoTempo"
            :key="m.id"
            :class="{ excluido: m.excluido }"
            :data-testid="`mov-${m.id}`"
          >
            <td>{{ dataBr(m.em.slice(0, 10)) }} {{ m.em.slice(11, 16) }}</td>
            <td>
              {{ m.operacao.nome }}
              <span v-if="m.excluido" class="secundario">
                · {{ t('adt.same.excluido') }} {{ m.motivoExclusao ?? '' }}</span
              >
              <span v-if="m.protocolo" class="secundario"> · {{ m.protocolo }}</span>
              <span v-if="m.aceito" class="secundario"> · {{ t('adt.same.aceito') }}</span>
              <span v-if="m.cobrada" class="secundario"> · {{ t('adt.same.cobrada') }}</span>
            </td>
            <td>{{ m.origem.nome }}</td>
            <td>{{ m.destino.nome }}</td>
            <td>{{ m.responsavel }}</td>
            <td>
              <SanteBotao
                v-if="podeMovimentar && !m.excluido && !m.aceito && [2, 3, 5, 6].includes(m.operacao.codigo)"
                variante="texto"
                :rotulo="t('adt.same.aceitar')"
                :desabilitado="ocupado"
                :data-testid="`aceitar-${m.id}`"
                @acionar="aceitar(m.id)"
              />
              <template v-if="podeDesfazer && ultimo && m.id === ultimo.id">
                <SanteCampoTexto
                  v-model="motivoDesfazer"
                  :rotulo="t('adt.same.desfazerTexto')"
                  :max-bytes="200"
                />
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('adt.same.desfazer')"
                  :desabilitado="motivoDesfazer.trim().length < 10 || ocupado"
                  :data-testid="`desfazer-${m.id}`"
                  @acionar="desfazer(m.id)"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <section class="painel" aria-labelledby="same-atrasadas" data-testid="same-atrasadas">
      <h2 id="same-atrasadas">{{ t('adt.same.atrasadasTitulo') }}</h2>
      <ErroAdt v-if="atrasadas.isError.value" :erro="atrasadas.error.value" />
      <p v-else-if="!atrasadas.data.value" role="status">{{ t('adt.carregando') }}</p>
      <p v-else-if="atrasadas.data.value.itens.length === 0">{{ t('adt.same.semAtrasadas') }}</p>
      <table v-else class="tabela">
        <caption class="secundario">
          {{
            t('adt.same.atrasadasTitulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('adt.same.contaColuna') }}</th>
            <th scope="col">{{ t('adt.same.destino') }}</th>
            <th scope="col">{{ t('adt.same.desde') }}</th>
            <th scope="col">{{ t('adt.same.prazo') }}</th>
            <th scope="col">{{ t('adt.acoesColuna') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in atrasadas.data.value.itens" :key="a.movimento" :data-testid="`atrasada-${a.conta}`">
            <td>{{ a.conta }}</td>
            <td>{{ a.setor.nome }}</td>
            <td>{{ dataBr(a.desde.slice(0, 10)) }}</td>
            <td>{{ dataBr(a.prazo) }} · {{ t('adt.same.diasAtraso', { n: a.diasAtraso }) }}</td>
            <td>
              <span v-if="a.cobrada" class="secundario">{{ t('adt.same.cobrada') }}</span>
              <SanteBotao
                v-if="podeMovimentar"
                variante="texto"
                :rotulo="t('adt.same.cobrar')"
                :desabilitado="ocupado"
                :data-testid="`cobrar-${a.conta}`"
                @acionar="cobrar(a.conta, a.movimento)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="atrasadas.data.value?.cortada" class="secundario">{{ t('adt.cortada') }}</p>
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.excluido td {
  text-decoration: line-through;
}
</style>
