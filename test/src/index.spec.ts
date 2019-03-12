'use strict';

import * as AWS from 'aws-sdk';
import {Squiss} from '../../dist/';
import {SQSStub} from '../stubs/SQSStub';
import delay from 'delay';
import {IMessageOpts, Message} from '../../dist/Message';
// @ts-ignore
import * as sinon from 'sinon';
import * as chai from 'chai';
import {ISquissOptions} from '../../src';
import {SQS} from 'aws-sdk';

const should = chai.should();
let inst: Squiss | null = null;
const origSQS = AWS.SQS;
const wait = (ms?: number) => delay(ms === undefined ? 20 : ms);

describe('index', () => {
  afterEach(() => {
    if (inst) {
      inst!.stop();
    }
    inst = null;
    // @ts-ignore
    AWS.SQS = origSQS;
  });
  describe('constructor', () => {
    it('creates a new Squiss instance', () => {
      inst = new Squiss({
        queueUrl: 'foo',
        unwrapSns: true,
        visibilityTimeoutSecs: 10,
      } as ISquissOptions);
      should.exist(inst);
    });
    it('fails if queue is not specified', () => {
      let errored = false;
      try {
        new Squiss();
      } catch (e) {
        should.exist(e);
        e.should.be.instanceOf(Error);
        errored = true;
      }
      errored.should.be.true;
    });
    it('provides a configured sqs client instance', () => {
      inst = new Squiss({
        queueUrl: 'foo',
        awsConfig: {
          region: 'us-east-1',
        },
      } as ISquissOptions);
      inst!.should.have.property('sqs');
      (inst!.sqs as any as SQSStub).should.be.an('object');
      (inst!.sqs as any as SQSStub).config.region!.should.equal('us-east-1');
    });
    it('accepts an sqs function for instantiation if one is provided', () => {
      const spy = sinon.spy();
      inst = new Squiss({
        queueUrl: 'foo',
        SQS: spy,
      } as ISquissOptions);
      inst!.should.have.property('sqs');
      (inst!.sqs as any as SQSStub).should.be.an('object');
      spy.should.be.calledOnce();
    });
    it('accepts an instance of sqs client if one is provided', () => {
      inst = new Squiss({
        queueUrl: 'foo',
        SQS: {},
      } as ISquissOptions);
      inst!.should.have.property('sqs');
      (inst!.sqs as any as SQSStub).should.be.an('object');
    });
  });
  describe('Receiving', () => {
    it('reports the appropriate "running" status', () => {
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!._getBatch = () => {
      };
      inst!.running.should.eq(false);
      inst!.start();
      inst!.running.should.eq(true);
    });
    it('treats start() as idempotent', () => {
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!._getBatch = () => {
      };
      inst!.running.should.eq(false);
      inst!.start();
      inst!.start();
      inst!.running.should.eq(true);
    });
    it('receives a batch of messages under the max', () => {
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(5) as any as SQS;
      inst!.on('gotMessages', spy);
      inst!.start();
      return wait().then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith(5);
      });
    });
    it('receives batches of messages', () => {
      const batches: any = [];
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(15, 0) as any as SQS;
      inst!.on('gotMessages', (count: number) => batches.push({total: count, num: 0}));
      inst!.on('message', () => batches[batches.length - 1].num++);
      inst!.once('queueEmpty', spy);
      inst!.start();
      return wait().then(() => {
        spy.should.be.calledOnce();
        batches.should.deep.equal([
          {total: 10, num: 10},
          {total: 5, num: 5},
        ]);
      });
    });
    it('receives batches of messages when maxInflight = receiveBatchSize', () => {
      const batches: any = [];
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo', maxInFlight: 10, receiveBatchSize: 10} as ISquissOptions);
      inst!.sqs = new SQSStub(15, 0) as any as SQS;
      inst!.on('gotMessages', (count: number) => batches.push({total: count, num: 0}));
      inst!.on('message', (m: Message) => {
        batches[batches.length - 1].num++;
        m.del();
      });
      inst!.once('queueEmpty', spy);
      inst!.start();
      return wait().then(() => {
        spy.should.be.calledOnce();
        batches.should.deep.equal([
          {total: 10, num: 10},
          {total: 5, num: 5},
        ]);
      });
    });
    it('receives batches of messages when maxInflight % receiveBatchSize != 0', () => {
      const batches: any = [];
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo', maxInFlight: 15, receiveBatchSize: 10} as ISquissOptions);
      inst!.sqs = new SQSStub(15, 0) as any as SQS;
      inst!.on('gotMessages', (count: number) => batches.push({total: count, num: 0}));
      inst!.once('queueEmpty', spy);
      inst!.on('message', (m: Message) => {
        batches[batches.length - 1].num++;
      });
      inst!.start();
      return wait().then(() => {
        spy.should.not.be.called();
        batches.should.deep.equal([
          {total: 10, num: 10},
          {total: 5, num: 5},
        ]);
      });
    });

    it('receives batches of messages as much as it can', () => {
      const batches: any = [];
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo', maxInFlight: 15, receiveBatchSize: 10} as ISquissOptions);
      inst!.sqs = new SQSStub(16, 0) as any as SQS;
      inst!.on('gotMessages', (count: number) => batches.push({total: count, num: 0}));
      inst!.once('queueEmpty', spy);
      inst!.on('message', (m: Message) => {
        batches[batches.length - 1].num++;
        if (batches.length === 2 && batches[batches.length - 1].num === 5) {
          m.del();
        }
      });
      inst!.start();
      return wait().then(() => {
        spy.should.not.be.called();
        batches.should.deep.equal([
          {total: 10, num: 10},
          {total: 5, num: 5},
          {total: 1, num: 1},
        ]);
      });
    });
    it('receives batches of messages as much as it can wiht min batch size', () => {
      const batches: any = [];
      const spy = sinon.spy();
      inst = new Squiss({
        queueUrl: 'foo',
        maxInFlight: 15,
        receiveBatchSize: 10,
        minReceiveBatchSize: 2,
      } as ISquissOptions);
      inst!.sqs = new SQSStub(16, 0) as any as SQS;
      inst!.on('gotMessages', (count: number) => batches.push({total: count, num: 0}));
      inst!.once('queueEmpty', spy);
      inst!.on('message', (m: Message) => {
        batches[batches.length - 1].num++;
        if (batches.length === 2 && batches[batches.length - 1].num >= 4) {
          m.del();
        }
      });
      inst!.start();
      return wait().then(() => {
        spy.should.not.be.called();
        batches.should.deep.equal([
          {total: 10, num: 10},
          {total: 5, num: 5},
          {total: 1, num: 1},
        ]);
      });
    });
    it('receives batches of messages as much as it can but with min batch size', () => {
      const batches: any = [];
      const spy = sinon.spy();
      inst = new Squiss({
        queueUrl: 'foo',
        maxInFlight: 15,
        receiveBatchSize: 10,
        minReceiveBatchSize: 2,
      } as ISquissOptions);
      inst!.sqs = new SQSStub(16, 0) as any as SQS;
      inst!.on('gotMessages', (count: number) => batches.push({total: count, num: 0}));
      inst!.once('queueEmpty', spy);
      inst!.on('message', (m: Message) => {
        batches[batches.length - 1].num++;
        if (batches.length === 2 && batches[batches.length - 1].num === 5) {
          m.del();
        }
      });
      inst!.start();
      return wait().then(() => {
        spy.should.not.be.called();
        batches.should.deep.equal([
          {total: 10, num: 10},
          {total: 5, num: 5},
        ]);
      });
    });
    it('receives batches of messages as much as it can and gets empty', () => {
      const batches: any = [];
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo', maxInFlight: 15, receiveBatchSize: 10} as ISquissOptions);
      inst!.sqs = new SQSStub(15, 0) as any as SQS;
      inst!.on('gotMessages', (count: number) => batches.push({total: count, num: 0}));
      inst!.once('queueEmpty', spy);
      inst!.on('message', (m: Message) => {
        batches[batches.length - 1].num++;
        if (batches.length === 2 && batches[batches.length - 1].num === 5) {
          m.del();
        }
      });
      inst!.start();
      return wait().then(() => {
        spy.should.be.calledOnce();
        batches.should.deep.equal([
          {total: 10, num: 10},
          {total: 5, num: 5},
        ]);
      });
    });
    it('emits queueEmpty event with no messages', () => {
      const msgSpy = sinon.spy();
      const qeSpy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(0, 0) as any as SQS;
      inst!.on('message', msgSpy);
      inst!.once('queueEmpty', qeSpy);
      inst!.start();
      return wait().then(() => {
        msgSpy.should.not.be.called();
        qeSpy.should.be.calledOnce();
      });
    });
    it('emits aborted when stopped with an active message req', () => {
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(0, 1000) as any as SQS;
      inst!.on('aborted', spy);
      inst!.start();
      return wait().then(() => {
        spy.should.not.be.called();
        inst!.stop();
        return wait();
      }).then(() => {
        spy.should.be.calledOnce();
        inst!.running.should.eq(false);
      });
    });

    it('should resolve when timeout exceeded and queue not drained', () => {
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(1, 1000) as any as SQS;
      inst!.on('aborted', spy);
      inst!.start();
      return wait().then(() => {
        spy.should.not.be.called();
        return inst!.stop(false, 1000);
      }).then((result: boolean) => {
        result.should.eq(false);
      });
    });
    it('should resolve when queue already drained', () => {
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(0, 1000) as any as SQS;
      inst!.on('aborted', spy);
      inst!.start();
      return wait().then(() => {
        spy.should.not.be.called();
        return inst!.stop(false, 1000);
      }).then((result: boolean) => {
        result.should.eq(true);
      });
    });
    it('should resolve when queue drained before timeout', () => {
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(1, 1000) as any as SQS;
      inst!.on('aborted', spy);
      inst!.on('message', (msg: Message) => {
        setTimeout(() => {
          msg.del();
        }, 1000);
      });
      inst!.start();
      return wait().then(() => {
        spy.should.not.be.called();
        return inst!.stop(false, 10000);
      }).then((result: boolean) => {
        result.should.eq(true);
      });
    });
    it('should not double resolve if queue drained after timeout', function() {
      this.timeout(5000);
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(1, 1000) as any as SQS;
      inst!.on('aborted', spy);
      inst!.on('message', (msg: Message) => {
        setTimeout(() => {
          msg.del();
        }, 1000);
      });
      inst!.start();
      return wait().then(() => {
        spy.should.not.be.called();
        return inst!.stop(false, 50);
      }).then((result: boolean) => {
        result.should.eq(false);
        return wait(2000);
      });
    });
    it('observes the maxInFlight cap', () => {
      const msgSpy = sinon.spy();
      const maxSpy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo', maxInFlight: 10} as ISquissOptions);
      inst!.sqs = new SQSStub(15) as any as SQS;
      inst!.on('message', msgSpy);
      inst!.on('maxInFlight', maxSpy);
      inst!.start();
      return wait().then(() => {
        msgSpy.should.have.callCount(10);
        maxSpy.should.have.callCount(1);
      });
    });
    it('respects maxInFlight as 0 (no cap)', () => {
      const msgSpy = sinon.spy();
      const qeSpy = sinon.spy();
      const gmSpy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo', maxInFlight: 0} as ISquissOptions);
      inst!.sqs = new SQSStub(35, 0) as any as SQS;
      inst!.on('message', msgSpy);
      inst!.on('gotMessages', gmSpy);
      inst!.once('queueEmpty', qeSpy);
      inst!.start();
      return wait(50).then(() => {
        msgSpy.should.have.callCount(35);
        gmSpy.should.have.callCount(4);
        qeSpy.should.have.callCount(1);
      });
    });
    it('reports the correct number of inFlight messages', () => {
      const msgs: Message[] = [];
      inst = new Squiss({queueUrl: 'foo', deleteWaitMs: 1} as ISquissOptions);
      inst!.sqs = new SQSStub(5) as any as SQS;
      inst!.on('message', (msg: Message) => msgs.push(msg));
      inst!.start();
      return wait().then(() => {
        inst!.inFlight.should.equal(5);
        inst!.deleteMessage(msgs.pop()!);
        inst!.handledMessage({} as any);
        return wait(1);
      }).then(() => {
        inst!.inFlight.should.equal(3);
      });
    });
    it('pauses polling when maxInFlight is reached; resumes after', () => {
      const msgSpy = sinon.spy();
      const maxSpy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo', maxInFlight: 10} as ISquissOptions);
      inst!.sqs = new SQSStub(11, 1000) as any as SQS;
      inst!.on('message', msgSpy);
      inst!.on('maxInFlight', maxSpy);
      inst!.start();
      return wait().then(() => {
        msgSpy.should.have.callCount(10);
        maxSpy.should.be.calledOnce();
        for (let i = 0; i < 10; i++) {
          inst!.handledMessage({} as any);
        }
        return wait();
      }).then(() => {
        msgSpy.should.have.callCount(11);
      });
    });
    it('observes the visibilityTimeout setting', () => {
      inst = new Squiss({queueUrl: 'foo', visibilityTimeoutSecs: 10} as ISquissOptions);
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'receiveMessage');
      inst!.start();
      return wait().then(() => {
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          MessageAttributeNames: ['All'],
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 10,
        });
      });
    });
    it('observes activePollIntervalMs', () => {
      const abortSpy = sinon.spy();
      const gmSpy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo', activePollIntervalMs: 1000} as ISquissOptions);
      inst!.sqs = new SQSStub(1, 0) as any as SQS;
      inst!.on('aborted', abortSpy);
      inst!.on('gotMessages', gmSpy);
      inst!.start();
      return wait().then(() => {
        gmSpy.should.be.calledOnce();
        abortSpy.should.not.be.called();
      });
    });
    it('observes idlePollIntervalMs', () => {
      const abortSpy = sinon.spy();
      const qeSpy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo', idlePollIntervalMs: 1000} as ISquissOptions);
      inst!.sqs = new SQSStub(1, 0) as any as SQS;
      inst!.on('aborted', abortSpy);
      inst!.on('queueEmpty', qeSpy);
      inst!.start();
      return wait().then(() => {
        qeSpy.should.be.calledOnce();
        abortSpy.should.not.be.called();
      });
    });
    it('receiveAttributes defaults to all', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst.sqs, 'receiveMessage');
      inst.start();
      return wait().then(() => {
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          MessageAttributeNames: ['All'],
        });
      });
    });
    it('observes receiveAttributes', () => {
      inst = new Squiss({queueUrl: 'foo', receiveAttributes: ['a']});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst.sqs, 'receiveMessage');
      inst.start();
      return wait().then(() => {
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          MessageAttributeNames: ['a'],
        });
      });
    });
  });
  describe('Deleting', () => {
    it('deletes messages using internal API', () => {
      const msgs: Message[] = [];
      inst = new Squiss({queueUrl: 'foo', deleteWaitMs: 1} as ISquissOptions);
      inst!.sqs = new SQSStub(5) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'deleteMessageBatch');
      inst!.on('message', (msg: Message) => msgs.push(msg));
      inst!.start();
      let promise: Promise<void>;
      return wait().then(() => {
        msgs.should.have.length(5);
        promise = inst!.deleteMessage(msgs.pop()!);
        return wait(10);
      }).then(() => {
        spy.should.be.calledOnce();
        return promise!.should.be.fulfilled('should be fullfiled');
      });
    });
    it('deletes messages using Message API', () => {
      const msgs: Message[] = [];
      inst = new Squiss({queueUrl: 'foo', deleteWaitMs: 1} as ISquissOptions);
      inst!.sqs = new SQSStub(5) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'deleteMessageBatch');
      inst!.on('message', (msg: Message) => msgs.push(msg));
      inst!.start();
      return wait().then(() => {
        msgs.should.have.length(5);
        msgs.pop()!.del();
        return wait(10);
      }).then(() => {
        spy.should.be.calledOnce();
      });
    });
    it('deletes messages in batches', () => {
      inst = new Squiss({queueUrl: 'foo', deleteWaitMs: 10} as ISquissOptions);
      inst!.sqs = new SQSStub(15) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'deleteMessageBatch');
      inst!.on('message', (msg: Message) => msg.del());
      inst!.start();
      return wait().then(() => {
        spy.should.be.calledTwice();
      });
    });
    it('deletes immediately with batch size=1', () => {
      inst = new Squiss({queueUrl: 'foo', deleteBatchSize: 1} as ISquissOptions);
      inst!.sqs = new SQSStub(5) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'deleteMessageBatch');
      inst!.on('message', (msg: Message) => msg.del());
      inst!.start();
      return wait().then(() => {
        spy.should.have.callCount(5);
      });
    });
    it('delWaitTime timeout should be cleared after timeout runs', () => {
      const msgs: Message[] = [];
      inst = new Squiss({queueUrl: 'foo', deleteBatchSize: 10, deleteWaitMs: 10} as ISquissOptions);
      inst!.sqs = new SQSStub(2) as any as SQS;
      const spy = sinon.spy(inst, '_deleteMessages');
      inst!.on('message', (msg: Message) => msgs.push(msg));
      inst!.start();
      return wait().then(() => {
        inst!.stop();
        msgs[0].del();
        return wait(15);
      }).then(() => {
        spy.should.be.calledOnce();
        msgs[1].del();
        return wait(15);
      }).then(() => {
        spy.should.be.calledTwice();
      });
    });
    it('requires a Message object be sent to deleteMessage', () => {
      inst = new Squiss({queueUrl: 'foo', deleteBatchSize: 1} as ISquissOptions);
      const promise = inst!.deleteMessage('foo' as any);
      return promise.should.be.rejectedWith(/Message/);
    });
  });
  describe('Failures', () => {
    it('emits delError when a message fails to delete', () => {
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo', deleteBatchSize: 1} as ISquissOptions);
      inst!.sqs = new SQSStub(1) as any as SQS;
      inst!.on('delError', spy);
      inst!.deleteMessage(new Message({
        msg: {
          MessageId: 'foo',
          ReceiptHandle: 'bar',
          Body: 'baz',
        },
      } as IMessageOpts));
      return wait().then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith({Code: '404', Id: 'foo', Message: 'Does not exist', SenderFault: true});
      });
    });
    it('emits error when delete call fails', () => {
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo', deleteBatchSize: 1} as ISquissOptions);
      inst!.sqs = new SQSStub(1) as any as SQS;
      (inst!.sqs as any as SQSStub).deleteMessageBatch = () => {
        return {
          promise: () => Promise.reject(new Error('test')),
          abort: () => Promise.reject(new Error('test')),
        };
      };
      inst!.on('error', spy);
      inst!.deleteMessage({
        raw: {
          MessageId: 'foo',
          ReceiptHandle: 'bar',
        },
      } as Message);
      return wait().then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith(sinon.match.instanceOf(Error));
      });
    });
    it('emits error when receive call fails', () => {
      const spy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(1) as any as SQS;
      (inst!.sqs as any as SQSStub).receiveMessage = () => {
        return {
          promise: () => Promise.reject(new Error('test')),
          abort: () => {
          },
        };
      };
      inst!.on('error', spy);
      inst!.start();
      return wait().then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith(sinon.match.instanceOf(Error));
      });
    });
    it('attempts to restart polling after a receive call fails', () => {
      const msgSpy = sinon.spy();
      const errSpy = sinon.spy();
      inst = new Squiss({queueUrl: 'foo', receiveBatchSize: 1, pollRetryMs: 5} as ISquissOptions);
      inst!.sqs = new SQSStub(2) as any as SQS;
      (sinon.stub(inst!.sqs, 'receiveMessage').callsFake(() => {
        ((inst!.sqs as any as SQSStub).receiveMessage as any).restore();
        return {
          promise: () => Promise.reject(new Error('test')),
          abort: () => {
          },
        };
      }));
      inst!.on('message', msgSpy);
      inst!.on('error', errSpy);
      inst!.start();
      return wait().then(() => {
        errSpy.should.be.calledOnce();
        msgSpy.should.be.calledTwice();
      });
    });
    it('emits error when GetQueueURL call fails', () => {
      const spy = sinon.spy();
      inst = new Squiss({queueName: 'foo'} as ISquissOptions);
      (inst!.sqs as any as SQSStub).getQueueUrl = (params: SQS.GetQueueUrlRequest) => {
        return {
          promise: () => Promise.reject(new Error('test')),
          abort: () => Promise.reject(new Error('test')),
        };
      };
      inst!.on('error', spy);
      inst!.start();
      return wait().then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith(sinon.match.instanceOf(Error));
      });
    });
  });
  describe('Testing', () => {
    it('allows queue URLs to be corrected to the endpoint hostname', () => {
      inst = new Squiss({queueName: 'foo', correctQueueUrl: true} as ISquissOptions);
      inst!.sqs = new SQSStub(1) as any as SQS;
      return inst!.getQueueUrl().then((url: string) => {
        url.should.equal('http://foo.bar/queues/foo');
      });
    });
  });
  describe('createQueue', () => {
    it('rejects if Squiss was instantiated without queueName', () => {
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(1) as any as SQS;
      return inst!.createQueue().should.be.rejected;
    });
    it('calls SQS SDK createQueue method with default attributes', () => {
      inst = new Squiss({queueName: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(1) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'createQueue');
      return inst!.createQueue().then((queueUrl: string) => {
        queueUrl!.should.be.a('string');
        spy.should.be.calledOnce();
        spy.should.be.calledWith({
          QueueName: 'foo',
          Attributes: {
            ReceiveMessageWaitTimeSeconds: '20',
            DelaySeconds: '0',
            MaximumMessageSize: '262144',
            MessageRetentionPeriod: '345600',
          },
        });
      });
    });
    it('configures VisibilityTimeout if specified', () => {
      inst = new Squiss({queueName: 'foo', visibilityTimeoutSecs: 15} as ISquissOptions);
      inst!.sqs = new SQSStub(1) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'createQueue');
      return inst!.createQueue().then((queueUrl: string) => {
        queueUrl!.should.be.a('string');
        spy.should.be.calledOnce();
        spy.should.be.calledWith({
          QueueName: 'foo',
          Attributes: {
            ReceiveMessageWaitTimeSeconds: '20',
            DelaySeconds: '0',
            MaximumMessageSize: '262144',
            MessageRetentionPeriod: '345600',
            VisibilityTimeout: '15',
          },
        });
      });
    });
    it('calls SQS SDK createQueue method with custom attributes', () => {
      inst = new Squiss({
        queueName: 'foo',
        receiveWaitTimeSecs: 10,
        delaySecs: 300,
        maxMessageBytes: 100,
        messageRetentionSecs: 60,
        visibilityTimeoutSecs: 10,
        queuePolicy: 'foo',
      } as ISquissOptions);
      inst!.sqs = new SQSStub(1) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'createQueue');
      return inst!.createQueue().then((queueUrl: string) => {
        queueUrl!.should.be.a('string');
        spy.should.be.calledOnce();
        spy.should.be.calledWith({
          QueueName: 'foo',
          Attributes: {
            ReceiveMessageWaitTimeSeconds: '10',
            DelaySeconds: '300',
            MaximumMessageSize: '100',
            MessageRetentionPeriod: '60',
            VisibilityTimeout: '10',
            Policy: 'foo',
          },
        });
      });
    });
  });
  describe('changeMessageVisibility', () => {
    it('calls SQS SDK changeMessageVisibility method', () => {
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(1) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'changeMessageVisibility');
      return inst!.changeMessageVisibility('bar', 1).then(() => {
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          ReceiptHandle: 'bar',
          VisibilityTimeout: 1,
        });
      });
    });
    it('calls SQS SDK changeMessageVisibility method', () => {
      inst = new Squiss({queueUrl: 'foo'} as ISquissOptions);
      inst!.sqs = new SQSStub(1) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'changeMessageVisibility');
      const msg = new Message({
        msg: {
          ReceiptHandle: 'bar',
        },
      } as IMessageOpts);
      return inst!.changeMessageVisibility(msg, 1).then(() => {
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          ReceiptHandle: 'bar',
          VisibilityTimeout: 1,
        });
      });
    });
  });
  describe('deleteQueue', () => {
    it('calls SQS SDK deleteQueue method with queue URL', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub(1) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'deleteQueue');
      return inst!.deleteQueue().then((res: object) => {
        res.should.be.an('object');
        spy.should.be.calledOnce();
        spy.should.be.calledWith({QueueUrl: 'foo'});
      });
    });
  });
  describe('getQueueUrl', () => {
    it('resolves with the provided queueUrl without hitting SQS', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub(1) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'getQueueUrl');
      return inst!.getQueueUrl().then((queueUrl: string) => {
        queueUrl.should.equal('foo');
        spy.should.not.be.called();
      });
    });
    it('asks SQS for the URL if queueUrl was not provided', () => {
      inst = new Squiss({queueName: 'foo'});
      inst!.sqs = new SQSStub(1) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'getQueueUrl');
      return inst!.getQueueUrl().then((queueUrl: string) => {
        queueUrl.indexOf('http').should.equal(0);
        spy.should.be.calledOnce();
        spy.should.be.calledWith({QueueName: 'foo'});
      });
    });
    it('caches the queueUrl after the first call to SQS', () => {
      inst = new Squiss({queueName: 'foo'});
      inst!.sqs = new SQSStub(1) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'getQueueUrl');
      return inst!.getQueueUrl().then(() => {
        spy.should.be.calledOnce();
        return inst!.getQueueUrl();
      }).then(() => {
        spy.should.be.calledOnce();
      });
    });
    it('includes the account number if provided', () => {
      inst = new Squiss({queueName: 'foo', accountNumber: 1234});
      inst!.sqs = new SQSStub(1) as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'getQueueUrl');
      return inst!.getQueueUrl().then((queueUrl: string) => {
        queueUrl.indexOf('http').should.equal(0);
        spy.should.be.calledOnce();
        spy.should.be.calledWith({
          QueueName: 'foo',
          QueueOwnerAWSAccountId: '1234',
        });
      });
    });
  });
  describe('getQueueVisibilityTimeout', () => {
    it('makes a successful API call', () => {
      inst = new Squiss({queueUrl: 'https://foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'getQueueAttributes');
      return inst!.getQueueVisibilityTimeout().then((timeout: number) => {
        should.exist(timeout);
        timeout.should.equal(31);
        spy.should.be.calledOnce();
        spy.should.be.calledWith({
          AttributeNames: ['VisibilityTimeout'],
          QueueUrl: 'https://foo',
        });
      });
    });
    it('caches the API call for successive function calls', () => {
      inst = new Squiss({queueUrl: 'https://foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'getQueueAttributes');
      return inst!.getQueueVisibilityTimeout().then((timeout: number) => {
        timeout.should.equal(31);
        spy.should.be.calledOnce();
        return inst!.getQueueVisibilityTimeout();
      }).then((timeout: number) => {
        should.exist(timeout);
        timeout.should.equal(31);
        spy.should.be.calledOnce();
      });
    });
    it('catches badly formed AWS responses', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      (inst!.sqs as any as SQSStub).getQueueAttributes = sinon.stub().returns({
        promise: () => ({foo: 'bar'}),
      });
      return inst!.getQueueVisibilityTimeout().should.be.rejectedWith(/foo/);
    });
  });
  describe('releaseMessage', () => {
    it('marks the message as handled and changes visibility to 0', () => {
      inst = new Squiss({queueName: 'foo'});
      inst!.sqs = new SQSStub(1) as any as SQS;
      const handledSpy = sinon.spy(inst, 'handledMessage');
      const visibilitySpy = sinon.spy(inst, 'changeMessageVisibility');
      return inst!.releaseMessage('foo' as any).then(() => {
        handledSpy.should.be.calledOnce();
        visibilitySpy.should.be.calledOnce();
        visibilitySpy.should.be.calledWith('foo', 0);
      });
    });
  });
  describe('purgeQueue', () => {
    it('calls SQS SDK purgeQueue method with queue URL', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'purgeQueue');
      return inst!.purgeQueue().then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith({QueueUrl: 'foo'});
        (inst!.sqs as any as SQSStub).msgs.length.should.equal(0);
        (inst!.sqs as any as SQSStub).msgCount.should.equal(0);
      });
    });
  });
  describe('sendMessage', () => {
    it('sends a string message with no extra arguments', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'sendMessage');
      return inst!.sendMessage('bar').then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith({QueueUrl: 'foo', MessageBody: 'bar'});
      });
    });
    it('sends a JSON message with no extra arguments', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'sendMessage');
      return inst!.sendMessage({bar: 'baz'}).then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith({QueueUrl: 'foo', MessageBody: '{"bar":"baz"}'});
      });
    });
    it('sends a message with a delay and attributes', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const buffer = Buffer.from('s');
      const spy = sinon.spy(inst!.sqs, 'sendMessage');
      return inst!.sendMessage('bar', 10, {baz: 'fizz', num: 1, bin: buffer, empty: undefined}).then(() => {
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          MessageBody: 'bar',
          DelaySeconds: 10,
          MessageAttributes: {
            baz: {
              DataType: 'String',
              StringValue: 'fizz',
            },
            empty: {
              DataType: 'String',
              StringValue: '',
            },
            num: {
              DataType: 'Number',
              StringValue: '1',
            },
            bin: {
              DataType: 'Binary',
              BinaryValue: buffer,
            },
          },
        });
      });
    });
  });
  describe('sendMessages', () => {
    it('sends a single string message with no extra arguments', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'sendMessageBatch');
      return inst!.sendMessages('bar').then((res: SQS.Types.SendMessageBatchResult) => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          Entries: [
            {Id: '0', MessageBody: 'bar'},
          ],
        });
        res.should.have.property('Successful').with.length(1);
        res.Successful[0].should.have.property('Id').equal('0');
      });
    });
    it('sends a single JSON message with no extra arguments', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'sendMessageBatch');
      return inst!.sendMessages({bar: 'baz'}).then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          Entries: [
            {Id: '0', MessageBody: '{"bar":"baz"}'},
          ],
        });
      });
    });
    it('sends a multiple JSON message with no extra arguments', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'sendMessageBatch');
      return inst!.sendMessages([{bar: 'baz'}, {bar1: 'baz1'}]).then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          Entries: [
            {Id: '0', MessageBody: '{"bar":"baz"}'},
            {Id: '1', MessageBody: '{"bar1":"baz1"}'},
          ],
        });
      });
    });
    it('sends a single message with delay and attributes', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'sendMessageBatch');
      return inst!.sendMessages('bar', 10, {baz: 'fizz'}).then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          Entries: [{
            Id: '0',
            MessageBody: 'bar',
            DelaySeconds: 10,
            MessageAttributes: {baz: {StringValue: 'fizz', DataType: 'String'}},
          }],
        });
      });
    });
    it('sends multiple messages with delay and single attributes object', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'sendMessageBatch');
      return inst!.sendMessages(['bar', 'baz'], 10, {baz: 'fizz'}).then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          Entries: [{
            Id: '0',
            MessageBody: 'bar',
            DelaySeconds: 10,
            MessageAttributes: {baz: {StringValue: 'fizz', DataType: 'String'}},
          }, {
            Id: '1',
            MessageBody: 'baz',
            DelaySeconds: 10,
            MessageAttributes: {baz: {StringValue: 'fizz', DataType: 'String'}},
          }],
        });
      });
    });
    it('sends multiple messages with delay and multiple attributes objects', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'sendMessageBatch');
      return inst!.sendMessages(['bar', 'baz'], 10, [{baz: 'fizz'}, {baz1: 'fizz1'}]).then(() => {
        spy.should.be.calledOnce();
        spy.should.be.calledWith({
          QueueUrl: 'foo',
          Entries: [{
            Id: '0',
            MessageBody: 'bar',
            DelaySeconds: 10,
            MessageAttributes: {baz: {StringValue: 'fizz', DataType: 'String'}},
          }, {
            Id: '1',
            MessageBody: 'baz',
            DelaySeconds: 10,
            MessageAttributes: {baz1: {StringValue: 'fizz1', DataType: 'String'}},
          }],
        });
      });
    });
    it('sends multiple batches of messages and merges successes', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'sendMessageBatch');
      const msgs = 'a.b.c.d.e.f.g.h.i.j.k.l.m.n.o'.split('.');
      return inst!.sendMessages(msgs).then((res: SQS.Types.SendMessageBatchResult) => {
        spy.should.be.calledTwice();
        (inst!.sqs as any as SQSStub).msgs.length.should.equal(15);
        res.should.have.property('Successful').with.length(15);
        res.should.have.property('Failed').with.length(0);
      });
    });
    it('sends multiple batches of messages and merges failures', () => {
      inst = new Squiss({queueUrl: 'foo'});
      inst!.sqs = new SQSStub() as any as SQS;
      const spy = sinon.spy(inst!.sqs, 'sendMessageBatch');
      const msgs = 'a.FAIL.c.d.e.f.g.h.i.j.k.l.m.n.FAIL'.split('.');
      return inst!.sendMessages(msgs).then((res: SQS.Types.SendMessageBatchResult) => {
        spy.should.be.calledTwice();
        (inst!.sqs as any as SQSStub).msgs.length.should.equal(13);
        res.should.have.property('Successful').with.length(13);
        res.should.have.property('Failed').with.length(2);
      });
    });
  });
  describe('auto-extensions', () => {
    it('initializes a TimeoutExtender', () => {
      inst = new Squiss({queueUrl: 'foo', autoExtendTimeout: true});
      inst!.sqs = new SQSStub() as any as SQS;
      return inst!.start().then(() => {
        should.exist(inst!._timeoutExtender);
        inst!._timeoutExtender!.should.not.equal(null);
        inst!._timeoutExtender!._opts.visibilityTimeoutSecs!.should.equal(31);
        inst!._timeoutExtender!._opts.noExtensionsAfterSecs!.should.equal(43200);
        inst!._timeoutExtender!._opts.advancedCallMs!.should.equal(5000);
      });
    });
    it('constructs a TimeoutExtender with custom options', () => {
      inst = new Squiss({
        queueUrl: 'foo',
        autoExtendTimeout: true,
        visibilityTimeoutSecs: 53,
        noExtensionsAfterSecs: 400,
        advancedCallMs: 4500,
      });
      inst!.sqs = new SQSStub() as any as SQS;
      return inst!.start().then(() => {
        should.exist(inst!._timeoutExtender);
        inst!._timeoutExtender!.should.not.equal(null);
        inst!._timeoutExtender!._opts.visibilityTimeoutSecs!.should.equal(53);
        inst!._timeoutExtender!._opts.noExtensionsAfterSecs!.should.equal(400);
        inst!._timeoutExtender!._opts.advancedCallMs!.should.equal(4500);
      });
    });
  });
});